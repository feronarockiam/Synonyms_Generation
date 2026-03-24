/* ──────────────────────────────────────────────────────────
   Synonym Studio — app.js (B&W + Editable Tags + Drafts)
   ────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

    // ─── STATE ─────────────────────────────────────────────
    let historyData = [];
    let draftsData = [];
    let currentEventSource = null;
    let currentView = 'view-custom';
    
    // ─── DOM ELEMENTS ──────────────────────────────────────
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    
    // Views
    const views = {
        'view-custom': document.getElementById('view-custom'),
        'view-index': document.getElementById('view-index'),
        'view-pipeline': document.getElementById('view-pipeline'),
        'view-drafts': document.getElementById('view-drafts'),
        'view-history': document.getElementById('view-history'),
        'view-settings': document.getElementById('view-settings')
    };

    const customTermsTA = document.getElementById('custom-terms');
    const fileUpload = document.getElementById('file-upload');
    const fileBadge = document.getElementById('file-badge');
    const btnGenerateCustom = document.getElementById('btn-generate-custom');
    const btnGenerateIndex = document.getElementById('btn-generate-index');
    
    const pipelinePercent = document.getElementById('pipeline-percent');
    const pipelineCount = document.getElementById('pipeline-count');
    const progressFill = document.getElementById('progress-fill');
    const pipelineStatusText = document.getElementById('pipeline-status-text');
    const pipelineCards = document.getElementById('pipeline-cards');
    const btnPipelineStop = document.getElementById('btn-pipeline-stop');
    const btnPipelineBack = document.getElementById('btn-pipeline-back');

    const draftsCards = document.getElementById('drafts-cards');
    const draftsEmpty = document.getElementById('drafts-empty');

    const historySearch = document.getElementById('history-search');
    const btnDoExport = document.getElementById('btn-do-export');

    // ─── INIT ──────────────────────────────────────────────
    updateMetrics();
    setInterval(updateMetrics, 15000);

    // ─── SIDEBAR & NAVIGATION ────────────────────────────────
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('expanded'));

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentEventSource && btn.dataset.view !== 'view-pipeline') {
                const conf = confirm("A pipeline is running. Do you want to abort it?");
                if (conf) stopPipeline(true);
                else return;
            }
            switchView(btn.dataset.view);
        });
    });

    function switchView(viewId) {
        document.querySelectorAll('.nav-item').forEach(b => {
            if (b.dataset.view === viewId) b.classList.add('active');
            else b.classList.remove('active');
        });
        
        Object.values(views).forEach(v => {
            if (v) v.classList.remove('active');
        });
        if (views[viewId]) views[viewId].classList.add('active');
        
        currentView = viewId;
        if (viewId === 'view-history') loadHistory();
        if (viewId === 'view-drafts') loadDrafts();
        updateMetrics();
    }

    // ─── METRICS ───────────────────────────────────────────
    async function updateMetrics() {
        try {
            const d = await fetch('/api/metrics').then(r => r.json());
            if (d.error) return;

            const elMap = {
                // API Stats (Safety checked)
                'val-claude-calls': d.claude_calls || 0,
                'val-claude-cost': d.claude_cost ? '$' + d.claude_cost.toFixed(4) : '$0.0000',
                'val-gemini-calls': d.gemini_calls || 0,
                'val-gemini-cost': d.gemini_cost ? '$' + d.gemini_cost.toFixed(4) : '$0.0000',
                
                // Synonym Stats
                'val-total-terms': d.totalTerms,
                'val-total-words': d.totalWords,
                'val-approved-terms': d.approvedTerms,
                'val-approved-words': d.approvedWords,
                'val-draft-terms': d.draftTerms,
                'val-draft-words': d.draftWords,
                'count-approved-terms': d.approvedTerms,
                'count-approved-words-header': d.approvedWords,
                'count-draft-terms': d.draftTerms,
                'count-draft-words-header': d.draftWords
            };

            for (const [id, val] of Object.entries(elMap)) {
                const el = document.getElementById(id);
                if (el) el.textContent = val ?? 0;
            }
        } catch (e) { console.warn("Metrics suppressed", e); }
    }

    // ─── TOASTS ───────────────────────────────────────────
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = type === 'success' ? 
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' :
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

        toast.innerHTML = `${icon}<span>${message}</span>`;
        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.classList.add('closing');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }

    // Model Change Toast
    document.querySelectorAll('input[name="llm-model"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                const name = e.target.value === 'claude' ? 'Claude 3.5 Haiku' : 'Gemini 1.5 Flash';
                showToast(`Switched to ${name} generator`, 'success');
            }
        });
    });

    // ─── FILE UPLOAD TRANSLATOR ────────────────────────────
    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = evt => {
            const lines = evt.target.result.trim().split('\n').filter(l => l.trim());
            const sep = customTermsTA.value.trim() ? '\n' : '';
            customTermsTA.value += sep + evt.target.result.trim();
            fileBadge.textContent = `${lines.length} terms loaded.`;
            setTimeout(() => fileBadge.textContent = '', 4000);
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // ─── JOB LAUNCHERS ──────────────────────────────────────
    btnGenerateCustom.addEventListener('click', async () => {
        const raw = customTermsTA.value.trim();
        if (!raw) return;
        const terms = raw.split('\n').map(t => t.trim()).filter(Boolean);
        if (!terms.length) return;

        btnGenerateCustom.disabled = true;
        btnGenerateCustom.innerHTML = 'Submitting...';
        
        try {
            const activeModel = document.querySelector('input[name="llm-model"]:checked').value;
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'custom', terms, model: activeModel }),
            });
            const data = await res.json();
            if (data.jobId) {
                showToast(`Job submitted: Processing ${terms.length} terms`, 'success');
                startPipelineStream(data.jobId, terms.length);
            }
        } catch (e) {
            showToast('Failed to submit job.', 'error');
        } finally {
            btnGenerateCustom.disabled = false;
            btnGenerateCustom.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Start Generating';
            customTermsTA.value = '';
        }
    });

    btnGenerateIndex.addEventListener('click', async () => {
        btnGenerateIndex.disabled = true;
        btnGenerateIndex.innerHTML = 'Submitting...';
        try {
            const activeModel = document.querySelector('input[name="llm-model"]:checked').value;
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'index', model: activeModel }),
            });
            const data = await res.json();
            if (data.jobId) {
                showToast("Production extraction started", "success");
                startPipelineStream(data.jobId, 0);
            }
        } catch (e) {
            showToast("Failed to start block processing", "error");
        } finally {
            btnGenerateIndex.disabled = false;
            btnGenerateIndex.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Production Extraction';
        }
    });

    // ─── UNIFIED PIPELINE STREAM ────────────────────────────
    function startPipelineStream(jobId, estTotal) {
        switchView('view-pipeline');
        
        pipelineCards.innerHTML = '';
        pipelineStatusText.textContent = 'Connecting to generation stream...';
        pipelineStatusText.style.color = 'var(--muted)';
        setProgress(0, estTotal || 1);
        
        btnPipelineStop.style.display = 'inline-flex';
        btnPipelineBack.style.visibility = 'hidden';
        
        currentEventSource = new EventSource(`/api/jobs/${jobId}/stream`);

        currentEventSource.onmessage = (e) => {
            const msg = JSON.parse(e.data);

            if (msg.type === 'status') {
                pipelineStatusText.textContent = msg.message;

            } else if (msg.type === 'progress') {
                pipelineStatusText.textContent = msg.message;
                setProgress(msg.done, msg.total);

            } else if (msg.type === 'batch_result') {
                setProgress(msg.done, msg.total);
                pipelineStatusText.textContent = `Processed ${msg.done} of ${msg.total} items.`;
                // Because drafts auto-save, we just show them in the pipeline view
                msg.results.forEach(item => appendCard(item, pipelineCards, true));
                updateMetrics();

            } else if (msg.type === 'batch_error') {
                setProgress(msg.done, msg.total);
                console.error('Batch Error:', msg.message);

            } else if (msg.type === 'error') {
                pipelineStatusText.textContent = 'Stream Error: ' + msg.message;
                pipelineStatusText.style.color = 'var(--danger)';
                finishPipeline();

            } else if (msg.type === 'done') {
                pipelineStatusText.textContent = `Completed! Successfully processed ${msg.total} terms.`;
                pipelineStatusText.style.color = 'var(--text)'; // B&W
                setProgress(msg.done, msg.total);
                finishPipeline();
            }
        };

        currentEventSource.onerror = () => {
            pipelineStatusText.textContent = 'Connection lost.';
            pipelineStatusText.style.color = 'var(--danger)';
            finishPipeline();
        };
    }

    function setProgress(done, total) {
        if (total === 0) return;
        const pct = Math.min(100, Math.round((done / total) * 100));
        progressFill.style.width = pct + '%';
        pipelinePercent.textContent = pct + '%';
        pipelineCount.textContent = `${done} / ${total}`;
    }

    function stopPipeline(isNavigation = false) {
        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
        if (!isNavigation) {
            pipelineStatusText.textContent = 'Processing aborted by user.';
            pipelineStatusText.style.color = 'var(--danger)';
        }
        finishPipeline();
    }

    function finishPipeline() {
        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
        btnPipelineStop.style.display = 'none';
        btnPipelineBack.style.visibility = 'visible';
        updateMetrics();
    }

    btnPipelineStop.addEventListener('click', () => stopPipeline(false));
    btnPipelineBack.addEventListener('click', () => switchView('view-custom'));


    // ─── CARD BUILDER (With Inline Editing) ─────────────────
    function appendCard(item, containerEl, prepend = false, isHistory = false) {
        const card = document.createElement('div');
        card.className = 'cluster-card';

        const renderTags = (arr, type) => arr.map((t, i) =>
            `<span class="tag ${type}">
                <span class="tag-text" contenteditable="true" 
                      onblur="window._editTag(this, '${type}', ${i})" 
                      onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}">
                      ${t}
                </span>
                <span class="rm" onclick="window._removeTag(this, '${type}', ${i})">×</span>
             </span>`
        ).join('');

        const variationsHtml = (item.variations && item.variations.length > 1) 
            ? `<div style="font-size: 0.75rem; color: var(--muted); margin-bottom: 0.5rem; background: #f4f4f5; padding: 4px 8px; border-radius: 4px;">
                <strong>Clustering:</strong> ${item.variations.join(', ')}
               </div>`
            : '';

        card.innerHTML = `
            <div>
                <h4>${item.product_type}</h4>
                ${variationsHtml}
                <div class="tag-group">
                    <span class="tag-group-label">Synonyms</span>
                    <div class="tags syn-tags">
                        ${renderTags(item.synonyms, 'syn')}
                        <button class="add-tag-btn" onclick="window._addTag(this, 'synonyms')">+ Add</button>
                    </div>
                </div>
                <div class="tag-group">
                    <span class="tag-group-label">Regional Variations</span>
                    <div class="tags reg-tags">
                        ${renderTags(item.regional_variations, 'reg')}
                        <button class="add-tag-btn" onclick="window._addTag(this, 'regional_variations')">+ Add</button>
                    </div>
                </div>
            </div>
            ${isHistory ? `
            <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button class="btn btn-secondary btn-block" onclick="window._updateCard(this)" style="flex:1">Update</button>
                <button class="btn btn-secondary btn-block" onclick="window._deleteCard(this)" style="flex:1; color: var(--danger); border-color: var(--border);">Delete</button>
            </div>
            ` : `
            <button class="btn btn-primary btn-block" onclick="window._approveCard(this)" style="margin-top: 1rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Approve & Save (${item.variations?.length || 1})
            </button>
            `}
        `;

        card.__item = item;
        card.__container = containerEl; // track where it lives for refresh
        card.__isHistory = isHistory; // keep track of mode for refresh

        if (prepend) containerEl.prepend(card);
        else containerEl.appendChild(card);
    }

    window._editTag = (spanEl, type, idx) => {
        const card = spanEl.closest('.cluster-card');
        const item = card.__item;
        const container = card.__container;
        const newVal = spanEl.textContent.trim();
        
        if (!newVal) {
            window._removeTag(spanEl, type, idx); // removed if emptied
            return;
        }

        if (type === 'syn') item.synonyms[idx] = newVal;
        else item.regional_variations[idx] = newVal;
    };

    window._removeTag = (el, type, idx) => {
        const card = el.closest('.cluster-card');
        const item = card.__item;
        const container = card.__container;
        if (type === 'syn') item.synonyms.splice(idx, 1);
        else item.regional_variations.splice(idx, 1);
        refreshCard(card, item, container);
    };

    window._addTag = (btn, field) => {
        const card = btn.closest('.cluster-card');
        const item = card.__item;
        const container = card.__container;
        const val = prompt(`Add ${field === 'synonyms' ? 'synonym' : 'regional variation'}:`);
        if (val?.trim()) {
            item[field].push(val.trim());
            refreshCard(card, item, container);
        }
    };

    window._approveCard = async (btn) => {
        const card = btn.closest('.cluster-card');
        const item = card.__item;

        item.cluster_terms = Array.from(new Set([
            item.product_type.toLowerCase(),
            ...item.synonyms.map(s => s.toLowerCase()),
            ...item.regional_variations.map(s => s.toLowerCase()),
        ]));

        btn.disabled = true;
        btn.innerHTML = 'Saving...';

        try {
            const res = await fetch('/api/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_type: item.product_type,
                    synonyms: item.synonyms,
                    regional_variations: item.regional_variations,
                    cluster_terms: item.cluster_terms,
                    source: item.source,
                    variations: item.variations // Added variations
                }),
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Successfully approved ${item.product_type}`, 'success');
                card.style.opacity = '.4';
                card.style.pointerEvents = 'none';
                btn.innerHTML = `✓ Saved (${data.count || 1})`;
                updateMetrics(); // Refresh count immediately
                // Remove from drafts array silently
                draftsData = draftsData.filter(d => !item.variations.includes(d.product_type));
                if (draftsData.length === 0 && currentView === 'view-drafts') {
                    draftsEmpty.style.display = 'block';
                }
            } else {
                showToast('Save failed: ' + data.error, 'error');
                btn.disabled = false;
                btn.innerHTML = 'Approve & Save';
            }
        } catch (e) {
            showToast('Network error during approval.', 'error');
            btn.disabled = false;
            btn.innerHTML = 'Approve & Save';
        }
    };

    window._updateCard = async (btn) => {
        const card = btn.closest('.cluster-card');
        const item = card.__item;

        item.cluster_terms = Array.from(new Set([
            item.product_type.toLowerCase(),
            ...item.synonyms.map(s => s.toLowerCase()),
            ...item.regional_variations.map(s => s.toLowerCase()),
        ]));

        const ogText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Saving...';

        try {
            const res = await fetch('/api/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_type: item.product_type,
                    synonyms: item.synonyms,
                    regional_variations: item.regional_variations,
                    cluster_terms: item.cluster_terms,
                    source: item.source,
                    variations: item.variations
                }),
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Updated ${item.product_type} in library`, 'success');
                btn.innerHTML = '✓ Updated';
                setTimeout(() => {
                    btn.innerHTML = ogText;
                    btn.disabled = false;
                }, 2000);
                updateMetrics();
            } else {
                showToast('Update failed: ' + data.error, 'error');
                btn.disabled = false;
                btn.innerHTML = ogText;
            }
        } catch (e) {
            showToast('Network error during update.', 'error');
            btn.disabled = false;
            btn.innerHTML = ogText;
        }
    };

    window._deleteCard = async (btn) => {
        if (!confirm('Are you sure you want to delete this synonym cluster?')) return;
        
        const card = btn.closest('.cluster-card');
        const item = card.__item;
        const ogText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '...';

        try {
            const res = await fetch('/api/history/' + encodeURIComponent(item.product_type), {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Deleted ${item.product_type} from library`, 'success');
                card.remove();
                historyData = historyData.filter(d => d.product_type !== item.product_type);
                if (historyData.length === 0) {
                    document.getElementById('history-empty').style.display = 'block';
                }
                updateMetrics();
            } else {
                showToast('Delete failed: ' + data.error, 'error');
                btn.disabled = false;
                btn.innerHTML = ogText;
            }
        } catch (e) {
            showToast('Network error during deletion.', 'error');
            btn.disabled = false;
            btn.innerHTML = ogText;
        }
    };

    function refreshCard(oldCard, item, container) {
        // Build new card structure
        const nextSibling = oldCard.nextSibling;
        oldCard.remove();
        
        const renderTags = (arr, type) => arr.map((t, i) =>
            `<span class="tag ${type}">
                <span class="tag-text" contenteditable="true" 
                      onblur="window._editTag(this, '${type}', ${i})" 
                      onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}">
                      ${t}
                </span>
                <span class="rm" onclick="window._removeTag(this, '${type}', ${i})">×</span>
             </span>`
        ).join('');

        const variationsHtml = (item.variations && item.variations.length > 1) 
            ? `<div style="font-size: 0.75rem; color: var(--muted); margin-bottom: 0.5rem; background: #f4f4f5; padding: 4px 8px; border-radius: 4px;">
                <strong>Clustering:</strong> ${item.variations.join(', ')}
               </div>`
            : '';

        const isHistory = oldCard.__isHistory || false;

        card.innerHTML = `
            <div>
                <h4>${item.product_type}</h4>
                ${variationsHtml}
                <div class="tag-group">
                    <span class="tag-group-label">Synonyms</span>
                    <div class="tags syn-tags">
                        ${renderTags(item.synonyms, 'syn')}
                        <button class="add-tag-btn" onclick="window._addTag(this, 'synonyms')">+ Add</button>
                    </div>
                </div>
                <div class="tag-group">
                    <span class="tag-group-label">Regional Variations</span>
                    <div class="tags reg-tags">
                        ${renderTags(item.regional_variations, 'reg')}
                        <button class="add-tag-btn" onclick="window._addTag(this, 'regional_variations')">+ Add</button>
                    </div>
                </div>
            </div>
            ${isHistory ? `
            <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button class="btn btn-secondary btn-block" onclick="window._updateCard(this)" style="flex:1">Update</button>
                <button class="btn btn-secondary btn-block" onclick="window._deleteCard(this)" style="flex:1; color: var(--danger); border-color: var(--border);">Delete</button>
            </div>
            ` : `
            <button class="btn btn-primary btn-block" onclick="window._approveCard(this)" style="margin-top: 1rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Approve & Save (${item.variations?.length || 1})
            </button>
            `}
        `;

        if (nextSibling) container.insertBefore(card, nextSibling);
        else container.appendChild(card);
    }

    // ─── DRAFTS ────────────────────────────────────────────
    async function loadDrafts() {
        try {
            draftsData = await fetch('/api/drafts').then(r => r.json());
            draftsCards.innerHTML = '';
            if (!draftsData.length) { 
                draftsEmpty.style.display = 'block'; 
                return; 
            }
            draftsEmpty.style.display = 'none';
            
            // Format DB rows back into object structure
            draftsData.forEach(row => {
                appendCard({
                    product_type: row.product_type,
                    synonyms: Array.isArray(row.synonyms) ? row.synonyms : (typeof row.synonyms === 'string' ? JSON.parse(row.synonyms) : []),
                    regional_variations: Array.isArray(row.regional_variations) ? row.regional_variations : (typeof row.regional_variations === 'string' ? JSON.parse(row.regional_variations) : []),
                    source: row.source
                }, draftsCards, false);
            });
        } catch (e) { /* silent */ }
    }


    // ─── HISTORY ───────────────────────────────────────────
    async function loadHistory() {
        try {
            historyData = await fetch('/api/history').then(r => r.json());
            renderHistory(historyData);
        } catch (e) { /* silent */ }
    }

    function renderHistory(data) {
        const hc = document.getElementById('history-cards');
        const empty = document.getElementById('history-empty');
        hc.innerHTML = '';
        if (!data.length) { empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        
        data.forEach(row => {
            appendCard({
                product_type: row.product_type,
                synonyms: typeof row.synonyms === 'string' ? JSON.parse(row.synonyms) : row.synonyms,
                regional_variations: typeof row.regional_variations === 'string' ? JSON.parse(row.regional_variations) : row.regional_variations,
                variations: [row.product_type], // default for history
                source: row.source
            }, hc, false, true);
        });
    }

    historySearch.addEventListener('input', () => {
        const q = historySearch.value.toLowerCase();
        renderHistory(historyData.filter(r => {
            const arrSyn = Array.isArray(r.synonyms) ? r.synonyms : (typeof r.synonyms === 'string' ? JSON.parse(r.synonyms) : []);
            const arrReg = Array.isArray(r.regional_variations) ? r.regional_variations : (typeof r.regional_variations === 'string' ? JSON.parse(r.regional_variations) : []);
            const s = arrSyn.join(' ').toLowerCase();
            const v = arrReg.join(' ').toLowerCase();
            return r.product_type.toLowerCase().includes(q) || s.includes(q) || v.includes(q);
        }));
    });

    // ─── EXPORT ────────────────────────────────────────────
    btnDoExport.addEventListener('click', () => {
        const scope = document.getElementById('export-scope').value;
        const format = document.querySelector('input[name="export-format"]:checked').value;
        const expand = document.getElementById('export-expand').checked;
        
        showToast(`Generating ${format.toUpperCase()} export...`, 'success');
        window.location.href = `/api/export?format=${format}&scope=${scope}&expand=${expand}`;
    });
});
