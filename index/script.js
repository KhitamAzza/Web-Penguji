
    const GAS_URL = 'https://script.google.com/macros/s/AKfycbyw2vC9JWBibrjY3y60YxOmhqPfIroHIOoT_bJzuMkp1RVbZO_ThGiWoxJrVtwRT18_rw/exec';
    let app = { user: null, criteria: [], currentStudent: null, students: [], examiners: [] };

    async function api(action, payload = {}) {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action, ...payload })
      });
      return res.json();
    }

    function showToast(msg, type) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast ' + (type || '');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 3000);
    }
    function $(id) { return document.getElementById(id); }

    // Loading overlay helpers
    function showLoading(text, subtext, progress) {
      const overlay = $('loadingOverlay');
      $('loadingText').textContent = text || 'Aplikasi sedang memuat';
      $('loadingSubtext').textContent = subtext || 'Mohon tunggu...';
      if (progress !== undefined) {
        $('loadingProgressBar').style.width = progress + '%';
      }
      overlay.classList.remove('hidden');
      // Prevent any interaction
      document.body.style.overflow = 'hidden';
      document.body.style.pointerEvents = 'none';
      overlay.style.pointerEvents = 'auto';
    }
    function hideLoading() {
      $('loadingOverlay').classList.add('hidden');
      document.body.style.overflow = '';
      document.body.style.pointerEvents = '';
    }
    function setLoadingProgress(text, subtext, progress) {
      $('loadingText').textContent = text;
      $('loadingSubtext').textContent = subtext;
      $('loadingProgressBar').style.width = progress + '%';
    }

    // Check if current examiner already scored current student
    async function checkIfAlreadyScored() {
      if (!app.user || app.user.role === 'admin' || !app.currentStudent) return;

      try {
        // Get all scores for current student
        const allScores = await api('getScores');
        const studentScore = allScores.find(s => s.id === app.currentStudent.id);

        if (studentScore && studentScore.examinerScores.length > 0) {
          // Check if this examiner already submitted by looking at Scores sheet
          // We need a new API endpoint, but for now we check if total examiners >= active count
          const activeEx = (await api('getExaminers')).filter(e => e.active).length;
          const submittedCount = studentScore.examinerScores.length;

          if (submittedCount >= activeEx) {
            lockScoreInputs();
          }
        }
      } catch (e) { console.error(e); }
    }

    function lockScoreInputs() {
      const grid = $('criteriaGrid');
      const inputs = grid.querySelectorAll('input');
      const btn = $('btnSubmit');

      inputs.forEach(inp => {
        inp.disabled = true;
        inp.closest('.criteria-item').classList.add('score-locked');
      });

      if (btn) {
        btn.disabled = true;
        btn.textContent = '🔒 Sudah Dinilai';
        btn.style.background = '#94a3b8';
      }

      $('lockedBanner').classList.add('show');
    }

    function unlockScoreInputs() {
      const grid = $('criteriaGrid');
      const inputs = grid.querySelectorAll('input');
      const btn = $('btnSubmit');

      inputs.forEach(inp => {
        inp.disabled = false;
        inp.closest('.criteria-item').classList.remove('score-locked');
      });

      if (btn) {
        btn.disabled = false;
        btn.textContent = '✅ Submit Scores';
        btn.style.background = '';
      }

      $('lockedBanner').classList.remove('show');
    }

    async function doLogin() {
      const pin = $('pinInput').value.trim();
      if (!pin) return showToast('Enter PIN', 'error');

      // Show loading immediately when login starts
      showLoading('Memverifikasi PIN...', 'Mohon tunggu sebentar', 20);

      try {
        setLoadingProgress('Memverifikasi PIN...', 'Mengecek kredensial examiner', 30);
        const res = await api('login', { pin: pin });
        if (res.error) {
          hideLoading();
          return showToast(res.error, 'error');
        }

        app.user = res;

        setLoadingProgress('Memuat data siswa...', 'Mengambil daftar peserta ujian', 50);
        $('userName').textContent = res.name;
        $('userRole').textContent = res.role;

        if (res.role === 'admin') {
          $('adminSection').classList.remove('hidden');
          $('scoringSection').classList.add('hidden');
          await loadStudentsForAdmin();
          await loadExaminersForAdmin();
        }

        setLoadingProgress('Memuat kriteria...', 'Mengambil data penilaian', 70);
        await loadCriteria();

        setLoadingProgress('Memuat siswa aktif...', 'Menyiapkan tampilan penilaian', 85);
        await refreshCurrentStudent();

        // Switch screens only after all data is loaded
        $('loginScreen').classList.add('hidden');
        $('mainScreen').classList.remove('hidden');

        setInterval(refreshCurrentStudent, 5000);

        setLoadingProgress('Siap!', 'Aplikasi siap digunakan', 100);
        await new Promise(r => setTimeout(r, 400));
        hideLoading();

      } catch (err) {
        hideLoading();
        showToast('Error: ' + err.message, 'error');
      }
    }
    function doLogout() { app.user = null; location.reload(); }

    async function loadStudentsForAdmin() {
      try {
        const list = await api('getStudents');
        app.students = list;
        const sel = $('studentSelect');
        sel.innerHTML = '<option value="">-- Choose student --</option>';
        list.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name + ' (' + s.status + ')';
          if (s.status === 'current') opt.selected = true;
          sel.appendChild(opt);
        });
      } catch (e) { console.error(e); }
    }

    async function setCurrentStudent() {
      const id = $('studentSelect').value;
      if (!id) return showToast('Select a student first', 'error');
      try {
        await api('setCurrentStudent', { id: id });
        showToast('Current student updated!', 'success');
        refreshCurrentStudent();
        loadStudentsForAdmin();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function loadExaminersForAdmin() {
      try {
        const list = await api('getExaminers');
        app.examiners = list;
        const div = $('examinerList');
        div.innerHTML = '';
        list.forEach(ex => {
          const row = document.createElement('div');
          row.className = 'examiner-row';
          row.innerHTML = `
            <span><strong>${ex.name}</strong> <span style="color:#94a3b8; font-size:0.75rem;">(PIN: ${ex.pin})</span></span>
            <label class="toggle-switch">
              <input type="checkbox" ${ex.active ? 'checked' : ''} onchange="toggleExaminer('${ex.pin}', this.checked)">
              <span class="slider"></span>
            </label>
          `;
          div.appendChild(row);
        });
      } catch (e) { console.error(e); }
    }

    async function toggleExaminer(pin, active) {
      try {
        await api('toggleExaminer', { pin: pin, active: active });
        showToast('Examiner updated', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    }

    async function loadCriteria() {
      try {
        const list = await api('getCriteria');
        app.criteria = list;
        renderCriteria();
      } catch (e) { console.error(e); }
    }

    function renderCriteria() {
      const grid = $('criteriaGrid');
      grid.innerHTML = '';
      app.criteria.forEach(c => {
        const div = document.createElement('div');
        div.className = 'criteria-item';
        const maxPoints = Math.round(c.weight * 100);
        div.innerHTML = `
          <div>
            <div class="criteria-label">${c.name}</div>
            <span class="criteria-max">Max: ${maxPoints} pts</span>
          </div>
          <input type="number" id="crit_${c.name.replace(/\s+/g, '_')}" class="criteria-input" min="0" max="${maxPoints}" placeholder="0">
        `;
        grid.appendChild(div);
      });
    }

    async function refreshCurrentStudent() {
      try {
        const student = await api('getCurrentStudent');

        // If student changed, unlock and clear inputs
        if (app.currentStudent && student && app.currentStudent.id !== student.id) {
          unlockScoreInputs();
          app.criteria.forEach(c => {
            const inputId = 'crit_' + c.name.replace(/\s+/g, '_');
            const inp = $(inputId);
            if (inp) inp.value = '';
          });
        }

        app.currentStudent = student;
        if (!student) {
          $('studentName').textContent = 'No student selected';
          $('studentId').textContent = 'Waiting for admin...';
          $('studentPhoto').classList.remove('show');
          return;
        }
        $('studentName').textContent = student.name;
        $('studentId').textContent = 'ID: ' + student.id;
        if (student.photo) {
          $('studentPhoto').src = student.photo;
          $('studentPhoto').classList.add('show');
        } else {
          $('studentPhoto').classList.remove('show');
        }

        // Check if already scored for this student
        if (app.user && app.user.role !== 'admin') {
          checkIfAlreadyScored();
        }
      } catch (e) { console.error(e); }
    }

    async function submitScores() {
      if (!app.currentStudent) return showToast('No student selected', 'error');
      if (!app.user || !app.user.pin) return showToast('Not logged in', 'error');

      const scores = {};
      for (let c of app.criteria) {
        const inputId = 'crit_' + c.name.replace(/\s+/g, '_');
        const val = $(inputId).value;
        const maxPoints = Math.round(c.weight * 100);
        if (val === '' || isNaN(val) || val < 0 || val > maxPoints) {
          return showToast(`Enter valid score (0-${maxPoints}) for ${c.name}`, 'error');
        }
        scores[c.name] = parseFloat(val);
      }

      // Full-page loading during submit
      showLoading('Mengirim nilai...', 'Menyimpan ke spreadsheet dan menghitung hasil', 30);
      const btn = $('btnSubmit');
      btn.disabled = true;

      try {
        setLoadingProgress('Mengirim nilai...', 'Menyimpan data penilaian', 60);
        const res = await api('submitScore', {
          studentId: app.currentStudent.id,
          examinerPin: app.user.pin,
          scores: scores
        });

        setLoadingProgress('Selesai!', 'Nilai berhasil disimpan', 100);
        await new Promise(r => setTimeout(r, 500));

        hideLoading();
        showToast(`Submitted! Total: ${res.total.toFixed(1)}`, 'success');

        // Lock inputs after successful submit
        lockScoreInputs();

      } catch (err) {
        hideLoading();
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false;
      }
    }

        // Auto-login: trigger on every input, auto-submit when 4 digits
    $('pinInput').addEventListener('input', function(e) {
      const val = this.value.trim();
      // Remove non-numeric
      this.value = val.replace(/\D/g, '');
      // Auto-submit when 4 digits entered
      if (this.value.length === 4) {
        doLogin();
      }
    });
    $('pinInput').addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });