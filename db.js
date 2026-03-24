const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: path.join(__dirname, '.env') });
}

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
    console.error('CRITICAL: MONGODB_URI is not defined in environment variables.');
} else {
    mongoose.connect(mongoUri)
        .then(() => console.log('Connected to MongoDB Atlas'))
        .catch(err => {
            console.error('MongoDB connection error details:');
            console.error(err);
        });
}

// ─────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────

const ClusterSchema = new mongoose.Schema({
    product_type: { type: String, unique: true, required: true, index: true },
    synonyms: { type: [String], default: [] },
    regional_variations: { type: [String], default: [] },
    cluster_terms: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft', index: true },
    source: { type: String, default: 'custom' },
    llm: { type: String, default: 'Claude' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

ClusterSchema.pre('save', function(next) {
    this.updated_at = Date.now();
    next();
});

const MetricSchema = new mongoose.Schema({
    api_calls: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    total_input_tokens: { type: Number, default: 0 },
    total_output_tokens: { type: Number, default: 0 },
    estimated_cost: { type: Number, default: 0 },
    
    claude_calls: { type: Number, default: 0 },
    claude_input_tokens: { type: Number, default: 0 },
    claude_output_tokens: { type: Number, default: 0 },
    claude_cost: { type: Number, default: 0 },
    
    gemini_calls: { type: Number, default: 0 },
    gemini_input_tokens: { type: Number, default: 0 },
    gemini_output_tokens: { type: Number, default: 0 },
    gemini_cost: { type: Number, default: 0 }
});

const Cluster = mongoose.model('Cluster', ClusterSchema);
const Metric = mongoose.model('Metric', MetricSchema);

// ─────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────

const getMetrics = async () => {
    let m = await Metric.findOne().sort({ _id: -1 });
    if (!m) {
        m = await Metric.create({});
    }
    return m.toObject();
};

const updateMetrics = async (inputTokens, outputTokens, calls = 1, model = 'claude') => {
    const claudeInputRate = 0.80;
    const claudeOutputRate = 4.00;
    const geminiInputRate = 0.075;
    const geminiOutputRate = 0.30;

    let cost = 0;
    const isGemini = model === 'gemini';
    if (isGemini) {
        cost = (inputTokens / 1000000) * geminiInputRate + (outputTokens / 1000000) * geminiOutputRate;
    } else {
        cost = (inputTokens / 1000000) * claudeInputRate + (outputTokens / 1000000) * claudeOutputRate;
    }

    const prefix = isGemini ? 'gemini' : 'claude';
    const totalTokens = inputTokens + outputTokens;

    return await Metric.findOneAndUpdate(
        {}, 
        { 
            $inc: {
                api_calls: calls,
                total_tokens: totalTokens,
                total_input_tokens: inputTokens,
                total_output_tokens: outputTokens,
                estimated_cost: cost,
                [`${prefix}_calls`]: calls,
                [`${prefix}_input_tokens`]: inputTokens,
                [`${prefix}_output_tokens`]: outputTokens,
                [`${prefix}_cost`]: cost
            }
        },
        { upsert: true, new: true }
    );
};

const getSynonymCounts = async () => {
    const clusters = await Cluster.find({}, 'status synonyms');
    let approvedWords = 0;
    let draftWords = 0;
    let approvedTerms = 0;
    let draftTerms = 0;

    clusters.forEach(c => {
        const count = c.synonyms.length;
        if (c.status === 'approved') {
            approvedWords += count;
            approvedTerms++;
        } else {
            draftWords += count;
            draftTerms++;
        }
    });

    return {
        approvedWords,
        draftWords,
        approvedTerms,
        draftTerms,
        totalWords: approvedWords + draftWords,
        totalTerms: approvedTerms + draftTerms
    };
};

module.exports = { 
    Cluster, 
    Metric, 
    getMetrics, 
    updateMetrics, 
    getSynonymCounts 
};
