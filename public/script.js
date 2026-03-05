// Tab switching
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;

    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${target}`);
    });
  });
});

// Helpers
function setButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

function setStatusPill(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('ok', 'error', 'loading');
  if (type) el.classList.add(type);
}

async function callJsonApi(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function callFormApi(url, formData) {
  const res = await fetch(url, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

function previewFile(input, imgEl, skeletonEl) {
  const file = input.files?.[0];
  if (!file) {
    imgEl.classList.add('hidden');
    skeletonEl.classList.remove('hidden');
    return;
  }
  const url = URL.createObjectURL(file);
  imgEl.src = url;
  imgEl.onload = () => {
    skeletonEl.classList.add('hidden');
    imgEl.classList.remove('hidden');
  };
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------- TAB 1: Generate (Gemini) ----------
const genForm = document.getElementById('form-generate');
const genPrompt = document.getElementById('gen-prompt');
const genStyle = document.getElementById('gen-style');
const genRatio = document.getElementById('gen-ratio');
const genQuality = document.getElementById('gen-quality');
const genBtn = document.getElementById('btn-generate');
const genStatus = document.getElementById('gen-status');
const genSkeleton = document.getElementById('gen-skeleton');
const genImage = document.getElementById('gen-image');
const genMeta = document.getElementById('gen-meta');

genForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = genPrompt.value.trim();
  if (!prompt) return;

  try {
    setButtonLoading(genBtn, true);
    setStatusPill(genStatus, 'Đang gọi Gemini...', 'loading');
    genSkeleton.classList.remove('hidden');
    genImage.classList.add('hidden');
    genMeta.textContent = 'Đang gửi yêu cầu tới Gemini AI...';

    const data = await callJsonApi('/api/generate', {
      prompt,
      style: genStyle.value,
      ratio: genRatio.value,
      quality: genQuality.value
    });

    const src = `data:${data.mimeType};base64,${data.imageBase64}`;
    genImage.src = src;
    genImage.onload = () => {
      genSkeleton.classList.add('hidden');
      genImage.classList.remove('hidden');
    };

    setStatusPill(genStatus, 'Generate thành công từ Gemini', 'ok');
    genMeta.innerHTML = `
      <strong>Prompt:</strong> ${escapeHtml(data.meta.prompt)}<br/>
      <strong>Style:</strong> ${escapeHtml(data.meta.style)} • 
      <strong>Ratio:</strong> ${escapeHtml(data.meta.ratio)} • 
      <strong>Quality:</strong> ${escapeHtml(data.meta.quality)}<br/>
      <strong>Model:</strong> ${escapeHtml(data.meta.model)} • 
      <strong>Time:</strong> ~${data.meta.inferenceTimeMs}ms
    `;
  } catch (err) {
    console.error(err);
    setStatusPill(genStatus, 'Lỗi khi gọi Gemini', 'error');
    genSkeleton.classList.add('hidden');
    genImage.classList.add('hidden');
    genMeta.textContent =
      'Có lỗi xảy ra khi gọi /api/generate. Kiểm tra GEMINI_API_KEY và log server.';
  } finally {
    setButtonLoading(genBtn, false);
  }
});

// ---------- TAB 2: Faceswap (Gemini assist) ----------
const fsForm = document.getElementById('form-faceswap');
const fsSourceInput = document.getElementById('fs-source');
const fsTargetInput = document.getElementById('fs-target');
const fsPrompt = document.getElementById('fs-prompt');
const fsBtn = document.getElementById('btn-faceswap');
const fsStatus = document.getElementById('fs-status');
const fsSrcSkeleton = document.getElementById('fs-src-skeleton');
const fsTgtSkeleton = document.getElementById('fs-tgt-skeleton');
const fsSrcImage = document.getElementById('fs-src-image');
const fsTgtImage = document.getElementById('fs-tgt-image');
const fsMeta = document.getElementById('fs-meta');

fsSourceInput.addEventListener('change', () =>
  previewFile(fsSourceInput, fsSrcImage, fsSrcSkeleton)
);
fsTargetInput.addEventListener('change', () =>
  previewFile(fsTargetInput, fsTgtImage, fsTgtSkeleton)
);

fsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const srcFile = fsSourceInput.files?.[0];
  const tgtFile = fsTargetInput.files?.[0];
  if (!srcFile || !tgtFile) return;

  try {
    setButtonLoading(fsBtn, true);
    setStatusPill(fsStatus, 'Đang gửi ảnh tới Gemini...', 'loading');
    fsMeta.textContent = 'Gemini đang phân tích hai ảnh và mô tả faceswap...';

    const fd = new FormData();
    fd.append('faceSource', srcFile);
    fd.append('faceTarget', tgtFile);
    if (fsPrompt.value.trim()) {
      fd.append('prompt', fsPrompt.value.trim());
    }

    const data = await callFormApi('/api/faceswap', fd);

    setStatusPill(fsStatus, 'Gemini phân tích xong', 'ok');
    fsMeta.innerHTML = `
      <strong>Message:</strong> ${escapeHtml(data.message)}<br/><br/>
      <strong>Mô tả chi tiết từ Gemini:</strong><br/>
      <pre style="white-space:pre-wrap;font-size:0.8rem;margin-top:4px;">${escapeHtml(
        data.description
      )}</pre>
      <br/>
      <strong>Model:</strong> ${escapeHtml(data.meta.model)} • 
      <strong>Time:</strong> ~${data.meta.inferenceTimeMs}ms
    `;
  } catch (err) {
    console.error(err);
    setStatusPill(fsStatus, 'Lỗi khi gọi Gemini', 'error');
    fsMeta.textContent =
      'Có lỗi xảy ra khi gọi /api/faceswap. Kiểm tra GEMINI_API_KEY và log server.';
  } finally {
    setButtonLoading(fsBtn, false);
  }
});

// ---------- TAB 3: Edit (Gemini) ----------
const edForm = document.getElementById('form-edit');
const edImageInput = document.getElementById('ed-image');
const edPrompt = document.getElementById('ed-prompt');
const edBtn = document.getElementById('btn-edit');
const edStatus = document.getElementById('ed-status');
const edSrcSkeleton = document.getElementById('ed-src-skeleton');
const edOutSkeleton = document.getElementById('ed-out-skeleton');
const edSrcImage = document.getElementById('ed-src-image');
const edOutImage = document.getElementById('ed-out-image');
const edMeta = document.getElementById('ed-meta');

edImageInput.addEventListener('change', () =>
  previewFile(edImageInput, edSrcImage, edSrcSkeleton)
);

edForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = edImageInput.files?.[0];
  const prompt = edPrompt.value.trim();
  if (!file || !prompt) return;

  try {
    setButtonLoading(edBtn, true);
    setStatusPill(edStatus, 'Đang gọi Gemini...', 'loading');
    edOutSkeleton.classList.remove('hidden');
    edOutImage.classList.add('hidden');
    edMeta.textContent = 'Đang gửi ảnh & prompt tới Gemini AI...';

    const fd = new FormData();
    fd.append('image', file);
    fd.append('prompt', prompt);

    const data = await callFormApi('/api/edit', fd);

    const src = `data:${data.mimeType};base64,${data.imageBase64}`;
    edOutImage.src = src;
    edOutImage.onload = () => {
      edOutSkeleton.classList.add('hidden');
      edOutImage.classList.remove('hidden');
    };

    setStatusPill(edStatus, 'Chỉnh sửa thành công từ Gemini', 'ok');
    edMeta.innerHTML = `
      <strong>Yêu cầu áp dụng:</strong> ${escapeHtml(
        data.meta.appliedPrompt
      )}<br/>
      <strong>Model:</strong> ${escapeHtml(data.meta.model)} • 
      <strong>Time:</strong> ~${data.meta.inferenceTimeMs}ms
    `;
  } catch (err) {
    console.error(err);
    setStatusPill(edStatus, 'Lỗi khi gọi Gemini', 'error');
    edOutSkeleton.classList.add('hidden');
    edOutImage.classList.add('hidden');
    edMeta.textContent =
      'Có lỗi xảy ra khi gọi /api/edit. Kiểm tra GEMINI_API_KEY và log server.';
  } finally {
    setButtonLoading(edBtn, false);
  }
});
