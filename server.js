import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG GEMINI ======
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyABw7MFMsvPR8F8XT4dtMvcqVMMc0AZf0c';
// Bạn NÊN dùng biến môi trường trên Stackblitz / .env, không commit key thật.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Multer (in-memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// ====== HELPER: CALL GEMINI TEXT→IMAGE ======
async function geminiTextToImage(prompt, options = {}) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'AIzaSyABw7MFMsvPR8F8XT4dtMvcqVMMc0AZf0c') {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }

  const { style = 'realistic', ratio = '1:1', quality = 'high' } = options;

  // Tùy chỉnh prompt cho Gemini
  const systemPrompt = `
Bạn là model tạo ảnh realistic chất lượng cao. 
Hãy tạo một ảnh duy nhất, phong cách ${style}, tỉ lệ ${ratio}, độ chi tiết ${quality}.
`;

  const url = `${GEMINI_API_BASE}/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: systemPrompt.trim() },
          { text: prompt }
        ]
      }
    ],
    // Yêu cầu trả về ảnh PNG
    generationConfig: {
      responseMimeType: 'image/png'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini text→image error: ${res.status} ${errText}`);
  }

  // Khi responseMimeType là image/png, Gemini trả về binary (body là ảnh)
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = 'image/png';

  return {
    base64,
    mimeType
  };
}

// ====== HELPER: GEMINI MULTIMODAL (IMAGE + TEXT) ======
async function geminiImageEditOrAssist(images, prompt, mode = 'edit') {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'AIzaSyABw7MFMsvPR8F8XT4dtMvcqVMMc0AZf0c') {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }

  const url = `${GEMINI_API_BASE}/models/gemini-1.5-pro:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  // images: array of { mimeType, data (Buffer) }
  const imageParts = images.map((img) => ({
    inlineData: {
      data: img.data.toString('base64'),
      mimeType: img.mimeType
    }
  }));

  const modeInstruction =
    mode === 'faceswap'
      ? 'Hãy mô tả chi tiết cách thay khuôn mặt từ ảnh nguồn sang ảnh đích, và nếu có thể, hãy tưởng tượng ảnh kết quả sau faceswap.'
      : 'Hãy chỉnh sửa ảnh theo yêu cầu một cách tự nhiên, giữ phong cách và ánh sáng gốc.';

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          ...imageParts,
          {
            text: `${modeInstruction}\n\nYêu cầu cụ thể: ${prompt}`
          }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini multimodal error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('\n')
      .trim() || '';

  return { text };
}

// ====== API: /api/generate (TEXT → IMAGE) ======
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, style, ratio, quality } = req.body || {};
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const t0 = Date.now();
    const img = await geminiTextToImage(prompt, {
      style: style || 'realistic',
      ratio: ratio || '1:1',
      quality: quality || 'high'
    });
    const dt = Date.now() - t0;

    res.json({
      imageBase64: img.base64,
      mimeType: img.mimeType,
      meta: {
        prompt,
        style: style || 'realistic',
        ratio: ratio || '1:1',
        quality: quality || 'high',
        model: 'gemini-1.5-flash',
        inferenceTimeMs: dt
      }
    });
  } catch (err) {
    console.error('Error /api/generate:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ====== API: /api/faceswap (ASSISTED BY GEMINI) ======
app.post(
  '/api/faceswap',
  upload.fields([
    { name: 'faceSource', maxCount: 1 },
    { name: 'faceTarget', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const source = req.files?.faceSource?.[0];
      const target = req.files?.faceTarget?.[0];

      if (!source || !target) {
        return res
          .status(400)
          .json({ error: 'Both faceSource and faceTarget are required' });
      }

      const prompt =
        req.body?.prompt ||
        'Hãy mô tả chi tiết ảnh kết quả sau khi thay khuôn mặt từ ảnh nguồn sang ảnh đích.';

      const t0 = Date.now();
      const result = await geminiImageEditOrAssist(
        [
          { data: source.buffer, mimeType: source.mimetype },
          { data: target.buffer, mimeType: target.mimetype }
        ],
        prompt,
        'faceswap'
      );
      const dt = Date.now() - t0;

      // Ở đây Gemini trả về mô tả text. Bạn có thể:
      // - Dùng text này để điều khiển 1 model faceswap khác.
      // - Hoặc hiển thị như "hướng dẫn" cho người dùng.
      res.json({
        message: 'Gemini đã phân tích 2 ảnh và mô tả faceswap.',
        description: result.text,
        meta: {
          model: 'gemini-1.5-pro',
          inferenceTimeMs: dt,
          sourceSize: source.size,
          targetSize: target.size
        }
      });
    } catch (err) {
      console.error('Error /api/faceswap:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }
);

// ====== API: /api/edit (IMAGE + PROMPT → IMAGE VIA GEMINI TEXT→IMAGE) ======
app.post('/api/edit', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    const prompt = req.body?.prompt;

    if (!file) {
      return res.status(400).json({ error: 'Image is required' });
    }
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Edit prompt is required' });
    }

    // Cách đơn giản: dùng prompt + mô tả ảnh gốc để tạo ảnh mới bằng text→image.
    // Cách tốt hơn (khi Google mở image editing): gửi ảnh + prompt vào model chỉnh sửa trực tiếp.
    const combinedPrompt = `
Ảnh gốc: ${file.originalname}, kích thước ~${Math.round(
      file.size / 1024
    )}KB.

Yêu cầu chỉnh sửa: ${prompt}

Hãy tạo một ảnh mới mô phỏng ảnh gốc nhưng đã áp dụng đầy đủ yêu cầu chỉnh sửa, 
giữ phong cách và ánh sáng tương tự.
`;

    const t0 = Date.now();
    const img = await geminiTextToImage(combinedPrompt, {
      style: 'realistic',
      ratio: '1:1',
      quality: 'high'
    });
    const dt = Date.now() - t0;

    res.json({
      imageBase64: img.base64,
      mimeType: img.mimeType,
      meta: {
        originalName: file.originalname,
        originalSize: file.size,
        appliedPrompt: prompt,
        model: 'gemini-1.5-flash',
        inferenceTimeMs: dt
      }
    });
  } catch (err) {
    console.error('Error /api/edit:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'AIzaSyABw7MFMsvPR8F8XT4dtMvcqVMMc0AZf0c') {
    console.warn(
      '⚠️  GEMINI_API_KEY chưa được cấu hình. Hãy đặt biến môi trường GEMINI_API_KEY.'
    );
  }
});

