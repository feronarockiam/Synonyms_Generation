const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fileUpload = require('express-fileupload');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const dotenv = require('dotenv');
const xlsx = require('xlsx');

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
}

const { Cluster, Metric, getMetrics, updateMetrics, getSynonymCounts } = require('./db');

const app = express();
app.use(cors());
// Increase payload limit for massive term pastes
app.use(express.json({ limit: '50mb' }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.MANAGER_PORT || 4001;

// AUTH: Claude
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// AUTH: Gemini (Vertex AI - Unified SDK)
let genaiClient;
try {
    const credsPath = path.join(__dirname, '..', 'data', 'creds.json');
    let credentials;
    if (process.env.GOOGLE_CREDS_JSON) {
        credentials = JSON.parse(process.env.GOOGLE_CREDS_JSON);
    } else if (fs.existsSync(credsPath)) {
        credentials = require(credsPath);
    }

    if (credentials) {
        // AUTH: Service Account (Vertex AI mode)
        genaiClient = new GoogleGenAI({
            apiKey: credentials.private_key, // Service account private key is treated as the secret
            project: credentials.project_id,
            location: 'us-central1'
        });
        console.log('Gemini initialized with Service Account (Vertex AI).');
    } else if (process.env.GEMINI_API_KEY) {
        // AUTH: API Key (Standalone mode)
        genaiClient = new GoogleGenAI(process.env.GEMINI_API_KEY);
        console.log('Gemini initialized with API Key fallback.');
    }
} catch (e) {
    console.warn('Gemini init failed:', e.message);
}

// Load prompts with robust error handling
const promptsDir = path.join(__dirname, '..', 'prompts');
let synonymsPrompt = '';
let regionalPrompt = '';

try {
    const synPath = path.join(promptsDir, 'synonyms.txt');
    const regPath = path.join(promptsDir, 'regional_variation.txt');

    if (!fs.existsSync(synPath)) {
        console.error(`CRITICAL: Prompt file missing at ${synPath}`);
        console.error('Available files in root:', fs.readdirSync(__dirname).join(', '));
        if (fs.existsSync(promptsDir)) {
            console.error('Available files in prompts/:', fs.readdirSync(promptsDir).join(', '));
        }
    }

    synonymsPrompt = fs.readFileSync(synPath, 'utf8').split('# PROCESS THIS PRODUCT TYPE')[0].trim();
    regionalPrompt = fs.readFileSync(regPath, 'utf8').split('# PROCESS THIS PRODUCT TYPE')[0].trim();
} catch (e) {
    console.error('Failed to load prompts:', e.message);
    // In production, we don't want to crash the whole server, but we must log it loudly.
    if (process.env.NODE_ENV === 'production') {
        synonymsPrompt = "Fallback: Return JSON only.";
        regionalPrompt = "Fallback: Return JSON only.";
    } else {
        throw e;
    }
}

// ─────────────────────────────────────────────────────────
// STATE & JOBS
// ─────────────────────────────────────────────────────────
const pendingJobs = new Map();

// ─────────────────────────────────────────────────────────
// SHARED UTILS
// ─────────────────────────────────────────────────────────

function buildBatchPrompt(baseRules, terms, fieldName) {
    const list = terms.map(t => `- ${t}`).join('\n');
    return `${baseRules}\n\n# BATCH PROCESSING TASK\nGenerate variations for EACH of the following terms:\n${list}\n\nCRITICAL RULE: Return ONLY a single raw JSON object — no markdown, no backticks, no explanations.\n\nEXACT FORMAT:\n{\n  "results": [\n    { "product_type": "term1", "${fieldName}": ["var1", "var2"] }\n  ]\n}`;
}

async function callClaudeBatch(terms, promptBase, fieldName) {
    const prompt = buildBatchPrompt(promptBase, terms, fieldName);
    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        system: 'You are an expert in Indian ecommerce search behavior. Return ONLY raw JSON. No markdown, no code blocks, no extra text.',
        messages: [{ role: 'user', content: prompt }],
    });

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in Claude response.`);

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed.results)) throw new Error('Missing "results" array.');
        return { data: parsed, inputTokens, outputTokens };
    } catch (e) {
        throw new Error(`JSON parse error.`);
    }
}

async function callGeminiBatch(terms, promptBase, fieldName) {
    const prompt = buildBatchPrompt(promptBase, terms, fieldName);
    
    // Unified Gen AI SDK (Vertex Mode)
    const result = await genaiClient.models.generateContent({
        model: "gemini-3-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
            systemInstruction: "You are an expert in Indian ecommerce search behavior. Return ONLY raw JSON. No markdown, no code blocks, no extra text."
        }
    });

    // Check if candidates exist
    if (!result.candidates || !result.candidates[0]) {
        throw new Error('Gemini response returned no candidates.');
    }

    const responseText = result.candidates[0].content.parts[0].text;
    const usage = result.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in Gemini response.`);

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed.results)) throw new Error('Missing "results" array.');
        return { data: parsed, inputTokens, outputTokens };
    } catch (e) {
        throw new Error(`JSON parse error from Gemini.`);
    }
}

function normalizePTypes(rawLines) {
    const exclusionWords = ['piece', 'kit', 'set', 'experiment', 'pack', 'color', 'pretend play', 'activity', 'doodle', 'magic'];
    const conceptMap = new Map(); // key -> { canonical, variations: Set }
    
    for (const line of rawLines) {
        let trimmed = line.trim();
        if (!trimmed) continue;
        let lower = trimmed.toLowerCase();

        // Strip non-essential descriptive suffixes
        if (lower.split(/\s+/).length > 3 && exclusionWords.some(ex => lower.includes(ex))) continue;

        const key = lower.replace(/[\s\-\_\/]+/g, '');
        
        if (!conceptMap.has(key)) {
            conceptMap.set(key, { canonical: trimmed, variations: new Set([trimmed]) });
        } else {
            conceptMap.get(key).variations.add(trimmed);
        }
    }
    
    // Return objects: { product_type: "play mat", variations: ["play mat", "playmat"] }
    return Array.from(conceptMap.values()).map(c => ({
        product_type: c.canonical,
        variations: Array.from(c.variations)
    }));
}

async function splitByCache(terms) {
    if (terms.length === 0) return { existing: [], missing: [] };
    try {
        const rows = await Cluster.find({
            product_type: { $in: terms.map(t => new RegExp(`^${t}$`, 'i')) }
        });
        const existingKeys = new Set(rows.map(r => r.product_type.toLowerCase()));
        return {
            existing: rows,
            missing: terms.filter(t => !existingKeys.has(t.toLowerCase())),
        };
    } catch (e) {
        throw e;
    }
}

function mergeResults(terms, synResult, regResult, source) {
    return terms.map(term => {
        const synFound = synResult.data.results.find(r => r.product_type.toLowerCase() === term.toLowerCase());
        const regFound = regResult.data.results.find(r => r.product_type.toLowerCase() === term.toLowerCase());
        const synonyms = synFound?.synonyms || [];
        const regional_variations = regFound?.regional_variations || [];
        const clusterSet = new Set([
            term.toLowerCase(),
            ...synonyms.map(s => s.toLowerCase()),
            ...regional_variations.map(s => s.toLowerCase()),
        ]);
        return { product_type: term, synonyms, regional_variations, cluster_terms: Array.from(clusterSet), source };
    });
}

// ─────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────

app.get('/api/metrics', async (req, res) => {
    try { 
        const stats = await getMetrics();
        const counts = await getSynonymCounts();
        res.json({ ...stats, ...counts });
    }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history', async (req, res) => {
    try {
        const rows = await Cluster.find({ status: 'approved' }).sort({ updated_at: -1 });
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/history/:product_type', async (req, res) => {
    const product_type = req.params.product_type;
    try {
        const result = await Cluster.deleteOne({ product_type });
        res.json({ success: true, deleted: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/drafts', async (req, res) => {
    try {
        const rows = await Cluster.find({ status: 'draft' }).sort({ updated_at: -1 });
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/approve', async (req, res) => {
    const { product_type, synonyms, regional_variations, cluster_terms, source, variations } = req.body;
    const targets = (variations && variations.length > 0) ? variations : [product_type];
    
    try {
        const promises = targets.map(target => {
            const finalCluster = Array.from(new Set([target.toLowerCase(), ...cluster_terms]));
            return Cluster.findOneAndUpdate(
                { product_type: target },
                {
                    synonyms,
                    regional_variations,
                    cluster_terms: finalCluster,
                    status: 'approved',
                    source: source || 'custom',
                    updated_at: Date.now()
                },
                { upsert: true }
            );
        });

        await Promise.all(promises);
        res.json({ success: true, count: targets.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create Job for Custom or Index
app.post('/api/jobs', (req, res) => {
    const { type, terms, model } = req.body;
    const jobId = Date.now().toString() + Math.random().toString().substring(2, 6);
    
    // Fire and forget, job is stored
    pendingJobs.set(jobId, { 
        type, 
        terms: terms || [], 
        mode: type === 'index' ? 'catalog' : 'custom',
        model: model || 'claude' 
    });
    res.json({ jobId });
});

// SSE Streaming Execution
app.get('/api/jobs/:id/stream', async (req, res) => {
    const jobId = req.params.id;
    const job = pendingJobs.get(jobId);
    
    if (!job) return res.status(404).send('Job not found');
    pendingJobs.delete(jobId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let isAborted = false;
    req.on('close', () => { isAborted = true; });

    const send = (type, data) => {
        if (!isAborted) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    try {
        let rawTerms = [];

        // 1. Gather all terms
        if (job.type === 'index') {
            send('status', { message: 'Loading p_types from unique_ptypes.txt...' });
            const filePath = path.join(__dirname, '../unique_ptypes.txt');
            if (fs.existsSync(filePath)) {
                rawTerms = fs.readFileSync(filePath, 'utf8').split('\n');
            } else {
                throw new Error('unique_ptypes.txt not found');
            }
        } else {
            rawTerms = job.terms;
        }

        if (isAborted) return res.end();

        // 2. Normalize and Group by Concept
        const allCanonical = normalizePTypes(rawTerms);

        // 3. Check Cache
        const canonicalTerms = allCanonical.map(c => c.product_type);
        const { existing, missing: pendingCanonical } = await splitByCache(canonicalTerms);
        
        let processed = existing.length;
        let total = allCanonical.length;

        send('progress', {
            message: `Cache check complete. ${existing.length} concepts cached. ${pendingCanonical.length} to process.`,
            total,
            done: processed
        });

        if (isAborted) return res.end();

        // 4. Send the Cached Results instantly
        if (existing.length > 0) {
            const formattedExisting = existing.map(r => ({
                product_type: r.product_type,
                synonyms: r.synonyms,
                regional_variations: r.regional_variations,
                cluster_terms: r.cluster_terms,
                source: 'cache',
                variations: [r.product_type]
            }));
            send('batch_result', { results: formattedExisting, tokens: 0, done: processed, total });
        }

        if (pendingCanonical.length === 0) {
            send('done', { message: 'All terms processed!', done: processed, total });
            return res.end();
        }

        // Mapping to get variation data back easily
        const conceptDataMap = new Map(allCanonical.map(c => [c.product_type, c.variations]));

        // 5. Uncapped Batched Processing
        const BATCH_SIZE = 6;

        for (let i = 0; i < pendingCanonical.length; i += BATCH_SIZE) {
            if (isAborted) {
                console.log(`Job ${jobId} aborted by client.`);
                break;
            }

            const batch = pendingCanonical.slice(i, i + BATCH_SIZE);
            send('status', { message: `Processing concepts: [${batch.join(', ')}]` });

            try {
                const processor = job.model === 'gemini' ? callGeminiBatch : callClaudeBatch;
                const [synResult, regResult] = await Promise.all([
                    processor(batch, synonymsPrompt, 'synonyms'),
                    processor(batch, regionalPrompt, 'regional_variations'),
                ]);

                if (isAborted) break;

                const inputTokens = synResult.inputTokens + regResult.inputTokens;
                const outputTokens = synResult.outputTokens + regResult.outputTokens;
                await updateMetrics(inputTokens, outputTokens, 2, job.model);

                const results = mergeResults(batch, synResult, regResult, job.mode);
                
                // Track variations for each result
                results.forEach(item => {
                    item.variations = conceptDataMap.get(item.product_type) || [item.product_type];
                });

                // Auto-save as draft so nothing is lost if user refreshes
                // We save for ALL variations in the cluster
                const generatorLlm = job.model === 'gemini' ? 'Gemini' : 'Claude';
                for (let item of results) {
                    for (let target of item.variations) {
                        const finalCluster = Array.from(new Set([target.toLowerCase(), ...item.cluster_terms]));
                        await Cluster.findOneAndUpdate(
                            { product_type: target },
                            {
                                synonyms: item.synonyms,
                                regional_variations: item.regional_variations,
                                cluster_terms: finalCluster,
                                status: 'draft',
                                source: item.source,
                                llm: generatorLlm,
                                updated_at: Date.now()
                            },
                            { upsert: true }
                        );
                    }
                }
                
                processed += batch.length;

                send('batch_result', { results, tokens: (inputTokens + outputTokens), done: processed, total });
            } catch (batchErr) {
                console.error(batchErr);
                send('batch_error', { terms: batch, message: batchErr.message, done: processed, total });
                // We do NOT abort on batch failure — we skip and continue to the next batch!
                processed += batch.length; 
            }
        }

        if (!isAborted) {
            send('done', { message: `Pipeline complete.`, done: processed, total });
        }
    } catch (err) {
        console.error('[SSE]', err.message);
        send('error', { message: err.message });
    } finally {
        res.end();
    }
});

// ─────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────

app.get('/api/export', async (req, res) => {
    const { format, scope, expand } = req.query;
    const shouldExpand = expand === 'true';
    
    try {
        let filter = {};
        if (scope === 'approved') filter.status = 'approved';
        else if (scope === 'draft') filter.status = 'draft';

        const rows = await Cluster.find(filter).sort({ product_type: 1 });
        const filename = `synonyms_${scope}_${new Date().toISOString().split('T')[0]}`;

        let exportData = [];
        if (shouldExpand) {
            rows.forEach(r => {
                const syns = r.synonyms || [];
                const regs = r.regional_variations || [];
                const allTerms = [...new Set([...syns, ...regs])];
                
                if (allTerms.length === 0) {
                    exportData.push(r);
                } else {
                    allTerms.forEach(term => {
                        exportData.push({
                            ...r.toObject(),
                            synonym_term: term
                        });
                    });
                }
            });
        } else {
            exportData = rows.map(r => r.toObject());
        }

        if (format === 'txt') {
            let content = shouldExpand 
                ? 'Product Type | Synonym/Variation | Status | Generator\n' + '='.repeat(80) + '\n'
                : 'Product Type | Cluster Terms | Status | Generator\n' + '='.repeat(90) + '\n';
                
            exportData.forEach(r => {
                if (shouldExpand) {
                    content += `${r.product_type.padEnd(25)} | ${r.synonym_term.padEnd(25)} | ${r.status.padEnd(8)} | ${r.llm || 'Claude'}\n`;
                } else {
                    const terms = r.cluster_terms || [];
                    content += `${r.product_type.padEnd(25)} | ${terms.join(', ').padEnd(35)} | ${r.status.padEnd(8)} | ${r.llm || 'Claude'}\n`;
                }
            });
            res.setHeader('Content-Disposition', `attachment; filename=${filename}.txt`);
            res.type('text/plain').send(content);
        } else {
            const excelRows = exportData.map(r => {
                if (shouldExpand) {
                    return {
                        'Product Type': r.product_type,
                        'Synonym/Variation': r.synonym_term,
                        'LLM': r.llm || 'Claude',
                        'Status': r.status,
                        'Source': r.source,
                        'Cluster Reference': (r.cluster_terms || []).join(', ')
                    };
                } else {
                    return {
                        'Product Type': r.product_type,
                        'Synonyms': (r.synonyms || []).join(', '),
                        'Regional Variations': (r.regional_variations || []).join(', '),
                        'Full Cluster': (r.cluster_terms || []).join(', '),
                        'LLM': r.llm || 'Claude',
                        'Status': r.status,
                        'Source': r.source,
                        'Last Updated': r.updated_at
                    };
                }
            });
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(excelRows), 'Synonyms');
            const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Synonym Manager API → http://localhost:${PORT}`));
}

module.exports = app;
