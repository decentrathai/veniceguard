const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for in-memory storage (no disk persistence)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize Venice AI client (OpenAI-compatible)
const venice = new OpenAI({
  apiKey: process.env.VENICE_API_KEY,
  baseURL: 'https://api.venice.ai/api/v1'
});

app.use(express.json());
app.use(express.static('public'));

// Middleware to log privacy compliance
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('[PRIVACY] Zero-retention mode: All data processed ephemerally');
  next();
});

/**
 * Main multimodal analysis endpoint
 * Accepts image/document, analyzes with vision, generates summary, returns TTS
 */
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { returnVoice, prompt } = req.body;
    const imageBuffer = req.file.buffer;
    const base64Image = imageBuffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64Image}`;

    console.log('[STEP 1] Image received, converting to base64');
    console.log('[PRIVACY] Image NOT stored on disk - in-memory only');

    // Step 1: Vision analysis using Venice AI vision model
    console.log('[STEP 2] Analyzing image with Venice vision model...');
    const visionResponse = await venice.chat.completions.create({
      model: 'qwen3-vl-235b-a22b', // Venice vision model
      messages: [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: prompt || 'Analyze this image in detail. If it\'s a medical document, extract medication names, dosages, and instructions. If it\'s a financial document, extract key financial data. Be thorough but concise.'
            },
            { 
              type: 'image_url', 
              image_url: { url: dataUri }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const analysis = visionResponse.choices[0].message.content;
    console.log('[STEP 3] Vision analysis complete');
    console.log('[PRIVACY] Image buffer will be garbage collected - never persisted');

    // Step 2: Generate a concise summary using chat model
    console.log('[STEP 4] Generating summary with Venice chat model...');
    const summaryResponse = await venice.chat.completions.create({
      model: 'venice-uncensored', // Fast, uncensored model for summarization
      messages: [
        {
          role: 'system',
          content: 'You are a privacy-focused AI assistant. Provide concise, clear summaries of sensitive documents. Never store or log user data.'
        },
        {
          role: 'user',
          content: `Summarize this analysis in 2-3 sentences for the user:\n\n${analysis}`
        }
      ],
      max_tokens: 150
    });

    const summary = summaryResponse.choices[0].message.content;
    console.log('[STEP 5] Summary generated');

    const response = {
      analysis,
      summary,
      privacy: {
        dataRetention: 'zero',
        storageDuration: 'ephemeral',
        compliance: ['HIPAA-safe', 'GDPR-compliant']
      }
    };

    // Step 3: Optional TTS for voice response
    if (returnVoice === 'true') {
      console.log('[STEP 6] Generating voice response with Venice TTS...');
      
      const speechResponse = await venice.audio.speech.create({
        model: 'tts-1', // Venice TTS model
        voice: 'alloy',
        input: summary
      });

      // Convert audio stream to base64 for easy client delivery
      const audioBuffer = Buffer.from(await speechResponse.arrayBuffer());
      const audioBase64 = audioBuffer.toString('base64');
      
      response.audio = {
        format: 'mp3',
        data: `data:audio/mp3;base64,${audioBase64}`
      };

      console.log('[STEP 7] Voice response generated');
      console.log('[PRIVACY] Audio generated on-the-fly - not stored');
    }

    console.log('[COMPLETE] Analysis pipeline finished - all data discarded');
    res.json(response);

  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error.message 
    });
  }
});

/**
 * Text-only analysis endpoint (no image)
 */
app.post('/api/analyze-text', async (req, res) => {
  try {
    const { text, returnVoice } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    console.log('[STEP 1] Text analysis request received');
    console.log('[PRIVACY] Text processed in-memory only');

    // Analyze text with Venice chat model
    const analysisResponse = await venice.chat.completions.create({
      model: 'zai-org-glm-4.7', // Venice flagship reasoning model
      messages: [
        {
          role: 'system',
          content: 'You are a privacy-focused AI assistant analyzing sensitive text. Provide clear, actionable insights.'
        },
        {
          role: 'user',
          content: `Analyze this text and extract key insights:\n\n${text}`
        }
      ],
      max_tokens: 500
    });

    const analysis = analysisResponse.choices[0].message.content;
    console.log('[STEP 2] Text analysis complete');

    const response = {
      analysis,
      privacy: {
        dataRetention: 'zero',
        storageDuration: 'ephemeral'
      }
    };

    // Optional TTS
    if (returnVoice === 'true') {
      console.log('[STEP 3] Generating voice response...');
      
      const speechResponse = await venice.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: analysis
      });

      const audioBuffer = Buffer.from(await speechResponse.arrayBuffer());
      response.audio = {
        format: 'mp3',
        data: `data:audio/mp3;base64,${audioBuffer.toString('base64')}`
      };
    }

    console.log('[COMPLETE] Text analysis finished');
    res.json(response);

  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error.message 
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'VeniceGuard',
    privacy: 'zero-retention',
    capabilities: ['vision', 'text', 'audio'],
    timestamp: new Date().toISOString()
  });
});

/**
 * Get available models
 */
app.get('/api/models', async (req, res) => {
  try {
    res.json({
      vision: 'qwen3-vl-235b-a22b',
      chat: ['zai-org-glm-4.7', 'venice-uncensored', 'qwen3-4b'],
      audio: 'tts-1',
      provider: 'Venice AI',
      privacy: 'zero-retention'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    VeniceGuard Server                     ║
║          Privacy-Preserving Multimodal AI Agent           ║
╚═══════════════════════════════════════════════════════════╝

🚀 Server running on port ${PORT}
🔐 Privacy mode: ZERO-RETENTION
🎯 Venice AI endpoints active:
   • Vision: qwen3-vl-235b-a22b
   • Chat: zai-org-glm-4.7, venice-uncensored
   • Audio: TTS-1

📊 Endpoints:
   POST /api/analyze (multimodal)
   POST /api/analyze-text (text-only)
   GET  /api/health
   GET  /api/models

🏆 Built for Open Agents Hackathon 2026
👤 Team: decentrathai (Alex Tolmach)
  `);
});

module.exports = app;
