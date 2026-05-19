// Caption library admin UI. Loads /data/instagram.json (the IG photo
// pool, populated by scripts/sync_instagram.py) and /data/instagram_captions.json
// (the manually-curated overlay), renders an editable row per photo, and
// stages edits in localStorage so work persists across sessions. When
// done, the user copies/downloads the merged YAML and pastes it into
// _data/instagram_captions.yml in the repo.

(function () {
    'use strict';

    const LS_KEY = 'instagram-captions-admin-edits-v1';
    const PAT_KEY = 'instagram-captions-gh-pat-v1';
    const REPO_OWNER = 'nickswalker';
    const REPO_NAME = 'alexwalker.co';
    const REPO_BRANCH = 'master';
    const CAPTIONS_PATH = '_data/instagram_captions.yml';
    const WORKFLOW_FILE = 'sync-instagram.yaml';
    // Server-side proxy: the stats server holds a long-lived GitHub PAT
    // and performs the commit + workflow dispatch on our behalf, so the
    // admin page never has to ship a token through localStorage. When
    // this URL is configured, syncToGitHub() prefers it over the direct
    // GitHub API path; if the proxy fails for any reason, the legacy
    // browser-side PAT flow is still available as a manual fallback.
    // The URL is the public Tailscale Funnel route for the stats service
    // (see /Volumes/docker/alexwalker-stats/README.md). Prefix is the
    // same ADMIN_PREFIX that gates the Visitors/Videos admin pages.
    const PROXY_BASE = 'https://nexus.tail1c6f41.ts.net/aw';
    const PROXY_PREFIX = 'OBkyCyBIlCtQNQWS00zg9JWDyWNCNNzv';
    const PROXY_SAVE_URL = `${PROXY_BASE}/admin/${PROXY_PREFIX}/captions/save`;

    const FIELDS = [
        { key: 'title', label: 'Title', placeholder: 'e.g. Bloody Sunday' },
        { key: 'location', label: 'Location', placeholder: 'e.g. Selma, Alabama' },
        { key: 'date', label: 'Date', placeholder: 'e.g. 3-3-2013' },
        { key: 'camera', label: 'Camera', placeholder: 'e.g. iPhone 5' },
        { key: 'lens', label: 'Lens', placeholder: 'e.g. Tamron AF 17-50mm ƒ2.8' },
    ];

    let items = [];
    let baseCaptions = {};   // from disk
    let edits = {};          // from localStorage (overrides baseCaptions per field)
    let grid;
    let statusEl;

    async function fetchJSON(url) {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
        return r.json();
    }

    function loadEdits() {
        try {
            edits = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
        } catch {
            edits = {};
        }
    }

    function saveEdits() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(edits));
        } catch (e) {
            console.error('localStorage write failed', e);
        }
    }

    function getMerged(id) {
        // Merged value per field: edits override base; only non-empty
        // edit values win.
        const base = baseCaptions[id] || {};
        const local = edits[id] || {};
        const out = {};
        FIELDS.forEach(f => {
            if (local[f.key] !== undefined) {
                if (local[f.key] !== '') out[f.key] = local[f.key];
            } else if (base[f.key]) {
                out[f.key] = base[f.key];
            }
        });
        const hide = local.hide !== undefined ? local.hide : !!base.hide;
        if (hide) out.hide = true;
        // Crop is an opaque object; local overrides base, local null = clear.
        if (local.crop !== undefined) {
            if (local.crop) out.crop = local.crop;
        } else if (base.crop) {
            out.crop = base.crop;
        }
        return out;
    }

    function hasCustomCrop(id) {
        return !!getMerged(id).crop;
    }

    function hasEdits(id) {
        return Object.keys(edits[id] || {}).length > 0;
    }

    function isMissingTitle(id) {
        const merged = getMerged(id);
        return !merged.title;
    }

    function formatTimestamp(iso) {
        try {
            const d = new Date(iso);
            return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
        } catch {
            return iso;
        }
    }

    function escapeHTML(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setStatus(msg, cls) {
        statusEl.textContent = msg;
        statusEl.className = 'status' + (cls ? ' ' + cls : '');
    }

    function renderRow(item) {
        const id = item.id;
        const merged = getMerged(id);
        const hidden = !!merged.hide;
        const igCaption = item.caption ? item.caption.split('\n')[0].slice(0, 100) : '';
        const date = formatTimestamp(item.timestamp);

        const fields = FIELDS.map(f => `
            <div class="field">
              <label>${f.label}</label>
              <input
                type="text"
                data-id="${id}"
                data-field="${f.key}"
                value="${escapeHTML(merged[f.key] || '')}"
                placeholder="${escapeHTML(f.placeholder)}"
              >
            </div>`).join('');

        return `
            <div class="photo ${hasEdits(id) ? 'has-edits' : ''} ${hidden ? 'is-hidden' : ''} ${hasCustomCrop(id) ? 'has-custom-crop' : ''}" data-id="${id}">
              <div class="thumb-wrap">
                <img class="thumb" src="${escapeHTML(item.thumb)}?t=${Date.now()}" alt="" loading="lazy" data-crop-trigger="1">
                <button class="crop-edit-btn" data-crop-edit="${id}" type="button" title="Edit crop">Crop</button>
              </div>
              <div class="fields">
                ${fields}
                <div class="meta-row">
                  <span>ID: <code>${id}</code></span>
                  <span>Posted ${escapeHTML(date)}</span>
                  ${item.permalink ? `<a href="${escapeHTML(item.permalink)}" target="_blank" rel="noopener">View on Instagram</a>` : ''}
                  ${igCaption ? `<span title="${escapeHTML(item.caption)}">IG: "${escapeHTML(igCaption)}${igCaption.length >= 100 ? '…' : ''}"</span>` : ''}
                  <label style="margin-left: auto;">
                    <input type="checkbox" data-id="${id}" data-field="hide" ${hidden ? 'checked' : ''}>
                    Hide this photo
                  </label>
                </div>
              </div>
            </div>`;
    }

    function applyFilters() {
        const q = document.getElementById('search').value.trim().toLowerCase();
        const onlyEdited = document.getElementById('only-edited').checked;
        const onlyMissing = document.getElementById('only-missing').checked;
        const showHidden = document.getElementById('show-hidden').checked;

        grid.querySelectorAll('.photo').forEach(row => {
            const id = row.dataset.id;
            const item = items.find(i => i.id === id);
            const merged = getMerged(id);
            // Date fields included three ways so casual queries hit:
            //   "2026"        → ISO-prefix match on the timestamp
            //   "2026-05"     → year-month
            //   "5-16-2026"   → M-D-YYYY (the formatted display string)
            //   "selma 2013"  → mixes location with date freely
            const isoDate = item && item.timestamp ? String(item.timestamp).slice(0, 10) : '';
            const formattedDate = item && item.timestamp ? formatTimestamp(item.timestamp) : '';
            const haystack = [
                id,
                merged.title || '',
                merged.location || '',
                merged.camera || '',
                merged.lens || '',
                merged.date || '',
                isoDate,
                formattedDate,
                item ? (item.caption || '') : '',
            ].join(' ').toLowerCase();

            let show = true;
            if (q && !haystack.includes(q)) show = false;
            if (onlyEdited && !hasEdits(id)) show = false;
            if (onlyMissing && !isMissingTitle(id)) show = false;
            if (merged.hide && !showHidden) show = false;
            row.style.display = show ? '' : 'none';
        });
    }

    function handleInput(e) {
        const el = e.target;
        const id = el.dataset.id;
        const field = el.dataset.field;
        if (!id || !field) return;

        edits[id] = edits[id] || {};
        let value;
        if (el.type === 'checkbox') {
            value = el.checked;
        } else {
            value = el.value.trim();
        }

        // If the value matches the base file, remove the edit (so we
        // don't write back redundant fields).
        const base = baseCaptions[id] || {};
        const baseVal = field === 'hide' ? !!base.hide : (base[field] || '');
        if (value === baseVal || (value === '' && !baseVal) || (value === false && !baseVal)) {
            delete edits[id][field];
            if (Object.keys(edits[id]).length === 0) delete edits[id];
        } else {
            edits[id][field] = value;
        }

        saveEdits();
        updateEditedState(id);
        updateStatus();
        // If the hide flag flipped, re-run the row filter so a freshly-
        // hidden row disappears immediately (when "Show hidden" is off)
        // instead of just dimming in place — and a freshly-unhidden row
        // reappears without the user having to refresh.
        if (field === 'hide') applyFilters();
    }

    function updateEditedState(id) {
        const row = grid.querySelector(`.photo[data-id="${id}"]`);
        if (!row) return;
        row.classList.toggle('has-edits', hasEdits(id));
        const merged = getMerged(id);
        row.classList.toggle('is-hidden', !!merged.hide);
        row.classList.toggle('has-custom-crop', !!merged.crop);
    }

    function updateStatus() {
        const editedCount = Object.keys(edits).length;
        if (editedCount === 0) {
            setStatus('No local edits.', 'saved');
        } else {
            setStatus(`${editedCount} photo${editedCount === 1 ? '' : 's'} with unsaved local edits.`, 'dirty');
        }
    }

    function yamlEscape(s) {
        // Always double-quote strings to be safe with special chars.
        // Escape backslash and double-quote.
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    function generateYAML() {
        const header = [
            '# Manually curated caption metadata for Instagram stills.',
            '# Keyed by IG media ID (matches `id` field in _data/instagram.yml).',
            '# Sync script never touches this file — it\'s yours.',
            '#',
            '# All fields are optional; the template uses whichever you provide and',
            '# falls back to the IG caption / timestamp for the rest.',
            '#',
            '# Schema:',
            '#   <ig_id>:',
            '#     title:    Short title for the still (overrides IG caption)',
            '#     location: e.g. "Selma, Alabama"',
            '#     date:     e.g. "3-3-2013"  (overrides IG timestamp)',
            '#     camera:   e.g. "iPhone 5"',
            '#     lens:     e.g. "Tamron AF 17-50mm ƒ2.8"',
            '#     hide:     true to exclude this post from the row entirely',
            '',
        ];

        // Merge base + edits → final captions object
        const allIds = new Set([
            ...Object.keys(baseCaptions || {}),
            ...Object.keys(edits || {}),
        ]);

        const lines = [];
        // Sort by IG post date (newest first) so the YAML is easier to scan
        const ordered = [...allIds].sort((a, b) => {
            const ai = items.find(i => i.id === a);
            const bi = items.find(i => i.id === b);
            return String(bi ? bi.timestamp : '').localeCompare(String(ai ? ai.timestamp : ''));
        });

        ordered.forEach(id => {
            const merged = getMerged(id);
            const keys = Object.keys(merged);
            if (keys.length === 0) return; // skip entries with no actual data
            lines.push(`${yamlEscape(id)}:`);
            FIELDS.forEach(f => {
                if (merged[f.key]) {
                    lines.push(`  ${f.key}: ${yamlEscape(merged[f.key])}`);
                }
            });
            if (merged.hide) lines.push('  hide: true');
            if (merged.crop) {
                const c = merged.crop;
                lines.push('  crop:');
                lines.push(`    cx: ${(+c.cx).toFixed(4)}`);
                lines.push(`    cy: ${(+c.cy).toFixed(4)}`);
                lines.push(`    size: ${(+c.size).toFixed(4)}`);
            }
            lines.push('');
        });

        return header.join('\n') + lines.join('\n');
    }

    async function copyYAML() {
        const yaml = generateYAML();
        try {
            await navigator.clipboard.writeText(yaml);
            setStatus('YAML copied. Paste into _data/instagram_captions.yml.', 'saved');
        } catch (e) {
            setStatus('Clipboard blocked — using download instead.', 'dirty');
            downloadYAML();
        }
    }

    function downloadYAML() {
        const yaml = generateYAML();
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'instagram_captions.yml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('Downloaded instagram_captions.yml.', 'saved');
    }

    function discardEdits() {
        if (Object.keys(edits).length === 0) return;
        if (!confirm('Discard all local edits? This cannot be undone.')) return;
        edits = {};
        saveEdits();
        renderAll();
        updateStatus();
        setStatus('Local edits discarded.', 'saved');
    }

    function renderAll() {
        if (items.length === 0) {
            grid.innerHTML = '<div class="empty">No Instagram items loaded. Run the sync script first.</div>';
            return;
        }
        // Sort by timestamp (newest first) for a stable scrollable list
        const ordered = items.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        grid.innerHTML = ordered.map(renderRow).join('');
    }

    // ---------- Crop editor ----------------------------------------------

    // The crop model is normalized to be image-resolution-independent:
    //   cx, cy = center of the square in image-coordinate space, 0..1
    //   size   = side length as a fraction of MIN(image_width, image_height),
    //            so a value of 1.0 = max possible square (fills short edge).
    // Python side (scripts/sync_instagram.py make_square_thumb) uses the
    // same convention.
    let cropCtx = null;  // { id, naturalW, naturalH, cx, cy, size, displayW, displayH }

    function defaultCropFor(naturalW, naturalH) {
        // Centered max-square that fits within the image — same as
        // ImageOps.fit centering=(0.5, 0.5) would produce.
        return { cx: 0.5, cy: 0.5, size: 1.0 };
    }

    function clampCrop(c, naturalW, naturalH) {
        // Min/max so the square stays fully inside the image and doesn't
        // shrink below a usable size.
        const minSize = Math.max(0.05, 50 / Math.min(naturalW, naturalH));
        const size = Math.max(minSize, Math.min(1, c.size));
        const sidePx = size * Math.min(naturalW, naturalH);
        const halfXNorm = (sidePx / 2) / naturalW;
        const halfYNorm = (sidePx / 2) / naturalH;
        const cx = Math.max(halfXNorm, Math.min(1 - halfXNorm, c.cx));
        const cy = Math.max(halfYNorm, Math.min(1 - halfYNorm, c.cy));
        return { cx, cy, size };
    }

    function paintCropOverlay() {
        if (!cropCtx) return;
        const square = document.getElementById('crop-square');
        const stage  = document.getElementById('crop-stage');
        const img    = document.getElementById('crop-image');
        const c = cropCtx;
        // Display dims match the rendered image; recompute every frame so
        // the overlay tracks any layout shift (e.g. window resize).
        const dispW = img.clientWidth;
        const dispH = img.clientHeight;
        stage.style.width  = dispW + 'px';
        stage.style.height = dispH + 'px';
        const sidePxNatural = c.size * Math.min(c.naturalW, c.naturalH);
        const scale = dispW / c.naturalW;
        const sidePxDisp = sidePxNatural * scale;
        const leftPxNatural = c.cx * c.naturalW - sidePxNatural / 2;
        const topPxNatural  = c.cy * c.naturalH - sidePxNatural / 2;
        square.style.width  = sidePxDisp + 'px';
        square.style.height = sidePxDisp + 'px';
        square.style.left   = (leftPxNatural * scale) + 'px';
        square.style.top    = (topPxNatural  * scale) + 'px';
        document.getElementById('crop-info').textContent =
            `${Math.round(sidePxNatural)}px @ ${(c.cx*100).toFixed(0)}% × ${(c.cy*100).toFixed(0)}%`;
    }

    function attachCropDragHandlers() {
        const square = document.getElementById('crop-square');
        const stage  = document.getElementById('crop-stage');
        let mode = null; // 'move' | 'resize-<corner>'
        let start = null;

        function pointerDown(e) {
            if (!cropCtx) return;
            const handle = e.target.closest('.crop-handle');
            mode = handle ? ('resize-' + handle.dataset.corner) : 'move';
            const img = document.getElementById('crop-image');
            start = {
                pointerX: e.clientX,
                pointerY: e.clientY,
                cx: cropCtx.cx,
                cy: cropCtx.cy,
                size: cropCtx.size,
                dispW: img.clientWidth,
                dispH: img.clientHeight,
            };
            square.setPointerCapture(e.pointerId);
            e.preventDefault();
        }

        function pointerMove(e) {
            if (!mode || !start || !cropCtx) return;
            const dxPx = e.clientX - start.pointerX;
            const dyPx = e.clientY - start.pointerY;
            const dxNorm = dxPx / start.dispW;
            const dyNorm = dyPx / start.dispH;
            const minDim = Math.min(cropCtx.naturalW, cropCtx.naturalH);
            // Convert pixel delta to "size-normalized" delta — pixels of
            // resize map to a fraction of MIN(naturalW,naturalH).
            const sizeScalePx = Math.min(start.dispW * (cropCtx.naturalW / minDim),
                                         start.dispH * (cropCtx.naturalH / minDim));
            if (mode === 'move') {
                cropCtx.cx = start.cx + dxNorm;
                cropCtx.cy = start.cy + dyNorm;
            } else {
                // Resize from opposite corner: each corner anchors the
                // diagonal opposite point of the square and recomputes
                // size from the dominant axis. cx/cy shift so anchor stays.
                const corner = mode.replace('resize-', '');
                // Sign vector: positive deltas grow the square for the
                // bottom-right corner; flipped for others.
                const sx = corner.endsWith('r') ? +1 : -1;
                const sy = corner.startsWith('b') ? +1 : -1;
                // Average the two axes so the square stays square; use
                // the larger of the two to feel responsive.
                const deltaPx = Math.max(sx * dxPx, sy * dyPx);
                const deltaSize = deltaPx / Math.min(start.dispW, start.dispH);
                let newSize = start.size + deltaSize;
                newSize = Math.max(0.05, Math.min(1, newSize));
                // Anchor = the corner opposite to the one being dragged.
                const startSidePxN = start.size * minDim;
                const newSidePxN   = newSize   * minDim;
                const anchorXNorm = start.cx + (sx * (startSidePxN / 2)) / cropCtx.naturalW * -1; // opposite corner
                const anchorYNorm = start.cy + (sy * (startSidePxN / 2)) / cropCtx.naturalH * -1;
                cropCtx.cx = anchorXNorm + (sx * (newSidePxN / 2)) / cropCtx.naturalW;
                cropCtx.cy = anchorYNorm + (sy * (newSidePxN / 2)) / cropCtx.naturalH;
                cropCtx.size = newSize;
            }
            const clamped = clampCrop(cropCtx, cropCtx.naturalW, cropCtx.naturalH);
            cropCtx.cx = clamped.cx;
            cropCtx.cy = clamped.cy;
            cropCtx.size = clamped.size;
            paintCropOverlay();
        }

        function pointerUp(e) {
            mode = null;
            start = null;
            try { square.releasePointerCapture(e.pointerId); } catch {}
        }

        square.addEventListener('pointerdown', pointerDown);
        square.addEventListener('pointermove', pointerMove);
        square.addEventListener('pointerup', pointerUp);
        square.addEventListener('pointercancel', pointerUp);
        window.addEventListener('resize', paintCropOverlay);
    }

    function openCropEditor(id) {
        const item = items.find(i => i.id === id);
        if (!item) return;
        const merged = getMerged(id);
        const modal = document.getElementById('crop-modal');
        const img   = document.getElementById('crop-image');

        modal.classList.add('open');
        modal.hidden = false;
        // Use the full-resolution image (item.image), not the thumb, so
        // the user is selecting from real pixels.
        img.src = item.image;

        img.onload = () => {
            const initial = merged.crop || defaultCropFor(img.naturalWidth, img.naturalHeight);
            cropCtx = {
                id,
                naturalW: img.naturalWidth,
                naturalH: img.naturalHeight,
                cx: +initial.cx,
                cy: +initial.cy,
                size: +initial.size,
            };
            const clamped = clampCrop(cropCtx, cropCtx.naturalW, cropCtx.naturalH);
            Object.assign(cropCtx, clamped);
            paintCropOverlay();
        };
    }

    function closeCropEditor() {
        const modal = document.getElementById('crop-modal');
        modal.classList.remove('open');
        modal.hidden = true;
        cropCtx = null;
    }

    function saveCropEditor() {
        if (!cropCtx) { closeCropEditor(); return; }
        const id = cropCtx.id;
        const crop = {
            cx: +cropCtx.cx.toFixed(4),
            cy: +cropCtx.cy.toFixed(4),
            size: +cropCtx.size.toFixed(4),
        };
        edits[id] = edits[id] || {};
        const base = (baseCaptions[id] && baseCaptions[id].crop) || null;
        // If the new crop matches the on-disk one, treat as "no edit" so
        // we don't accumulate redundant overrides.
        if (base && Math.abs(base.cx - crop.cx) < 1e-4
                 && Math.abs(base.cy - crop.cy) < 1e-4
                 && Math.abs(base.size - crop.size) < 1e-4) {
            delete edits[id].crop;
        } else {
            edits[id].crop = crop;
        }
        if (Object.keys(edits[id]).length === 0) delete edits[id];
        saveEdits();
        updateEditedState(id);
        updateStatus();
        closeCropEditor();
    }

    function resetCropEditor() {
        if (!cropCtx) return;
        const id = cropCtx.id;
        // null = explicitly clear; tells YAML output to omit and tells the
        // sync script to fall back to smartcrop.
        edits[id] = edits[id] || {};
        if ((baseCaptions[id] || {}).crop) {
            edits[id].crop = null; // signal "remove on-disk crop"
        } else {
            delete edits[id].crop;
        }
        if (Object.keys(edits[id]).length === 0) delete edits[id];
        saveEdits();
        updateEditedState(id);
        updateStatus();
        closeCropEditor();
    }

    // ---------- GitHub sync ----------------------------------------------

    function getPat() {
        try { return localStorage.getItem(PAT_KEY) || ''; } catch { return ''; }
    }
    function setPat(v) {
        try {
            if (v) localStorage.setItem(PAT_KEY, v);
            else   localStorage.removeItem(PAT_KEY);
        } catch (e) { console.error(e); }
    }

    async function gh(path, opts = {}) {
        const pat = getPat();
        if (!pat) throw new Error('No GitHub PAT — open "GitHub sync settings" and paste one.');
        const r = await fetch(`https://api.github.com${path}`, {
            ...opts,
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${pat}`,
                'X-GitHub-Api-Version': '2022-11-28',
                ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
                ...(opts.headers || {}),
            },
        });
        if (!r.ok) {
            const text = await r.text().catch(() => '');
            throw new Error(`GitHub ${r.status}: ${text.slice(0, 300)}`);
        }
        if (r.status === 204) return null;
        return r.json();
    }

    function utf8ToBase64(s) {
        return btoa(unescape(encodeURIComponent(s)));
    }

    async function syncViaProxy(yaml) {
        setStatus('Committing via stats-server proxy…', 'dirty');
        const r = await fetch(PROXY_SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
            throw new Error(data.error || `proxy ${r.status}`);
        }
        return data;
    }

    async function syncViaDirectPAT(yaml) {
        setStatus('Reading file SHA from GitHub…', 'dirty');
        let sha = null;
        try {
            const meta = await gh(
                `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CAPTIONS_PATH}?ref=${REPO_BRANCH}`
            );
            sha = meta.sha;
        } catch (e) {
            // 404 = file doesn't exist on the branch yet. First save
            // creates it; subsequent saves update with the returned SHA.
            if (!String(e.message).includes('404')) throw e;
            setStatus('File doesn\'t exist yet on branch — creating it…', 'dirty');
        }
        setStatus(sha ? 'Committing updated YAML…' : 'Creating file…', 'dirty');
        const body = {
            message: sha
                ? 'Update Instagram captions/crops via admin UI'
                : 'Create _data/instagram_captions.yml via admin UI',
            content: utf8ToBase64(yaml),
            branch: REPO_BRANCH,
        };
        if (sha) body.sha = sha;
        await gh(
            `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CAPTIONS_PATH}`,
            { method: 'PUT', body: JSON.stringify(body) }
        );
        setStatus('Triggering sync workflow…', 'dirty');
        await gh(
            `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
            {
                method: 'POST',
                body: JSON.stringify({ ref: REPO_BRANCH }),
            }
        );
    }

    async function refreshBaseCaptions() {
        // generateYAML() only emits IDs present in baseCaptions ∪ edits.
        // If the live YAML was updated since this page loaded (a save from
        // another tab, or this same tab pre-dating an earlier successful
        // save), baseCaptions is stale and any IDs only in the live YAML
        // get silently dropped on the next save. Refetching before each
        // save closes that hole — every save is now a merge of "current
        // disk state" + "this session's edits" rather than a blind
        // overwrite from a snapshot of unknown age.
        try {
            const fresh = await fetchJSON(
                '/data/instagram_captions.json?n=' + Date.now()
            );
            if (fresh && typeof fresh === 'object') {
                baseCaptions = fresh;
            }
        } catch (e) {
            // Couldn't refresh — proceed with the in-memory copy. Worst
            // case is we replicate the old buggy behavior for this save,
            // which is no worse than before.
            console.warn('[captions] refreshBaseCaptions failed:', e);
        }
    }

    async function syncToGitHub() {
        await refreshBaseCaptions();
        const yaml = generateYAML();
        // Prefer the server-side proxy: no PAT in the browser, no localStorage
        // expiry, no per-device setup. Fall back to direct-PAT only if the
        // proxy is unreachable (offline, server down) and the user has a PAT
        // saved from the old flow.
        try {
            await syncViaProxy(yaml);
        } catch (proxyErr) {
            console.warn('Proxy sync failed, attempting direct PAT path:', proxyErr);
            const hasPat = !!getPat();
            if (!hasPat) {
                setStatus(
                    `Sync failed via proxy: ${proxyErr.message}. ` +
                    'No GitHub PAT saved either — open "GitHub sync settings" ' +
                    'to paste one as a fallback.',
                    'dirty'
                );
                return;
            }
            try {
                await syncViaDirectPAT(yaml);
            } catch (e) {
                console.error(e);
                setStatus(
                    `Sync failed via proxy (${proxyErr.message}) and via PAT (${e.message})`,
                    'dirty'
                );
                return;
            }
        }
        // Promote every just-saved edit into baseCaptions in-memory so the
        // next render reflects the committed state without waiting for the
        // YAML → JSON → CDN deploy chain to finish (~5-7 min). Without this,
        // toggling 'hide' on a row, saving, then searching for it shows the
        // checkbox unchecked — because baseCaptions is still the page-load
        // snapshot and the local edit has just been wiped, leaving nothing
        // to read from.
        const editedIds = Object.keys(edits);
        editedIds.forEach(id => {
            const merged = getMerged(id);
            // getMerged returns only non-empty / non-default fields, so
            // assigning it wholesale is equivalent to what the server's
            // YAML now holds for this id.
            baseCaptions[id] = merged;
        });
        edits = {};
        saveEdits();
        renderAll();
        updateStatus();
        setStatus(
            'Committed + sync workflow dispatched. ' +
            'Check Actions tab for progress (1–2 min).',
            'saved'
        );
    }

    function wireCropEditorButtons() {
        document.getElementById('crop-cancel').addEventListener('click', closeCropEditor);
        document.getElementById('crop-save').addEventListener('click', saveCropEditor);
        document.getElementById('crop-reset').addEventListener('click', resetCropEditor);
        document.getElementById('crop-modal').addEventListener('click', (e) => {
            if (e.target.id === 'crop-modal') closeCropEditor();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeCropEditor();
        });
        attachCropDragHandlers();
    }

    function wireGhSettings() {
        // The PAT settings UI is no longer rendered (the stats-server proxy
        // handles auth). If a future redesign restores it, this function
        // re-wires it. Guard against the elements being absent so init()
        // can still call it unconditionally.
        const input = document.getElementById('gh-pat');
        const status = document.getElementById('gh-pat-status');
        const saveBtn = document.getElementById('gh-pat-save');
        const clearBtn = document.getElementById('gh-pat-clear');
        if (!input || !status || !saveBtn || !clearBtn) return;
        const refresh = () => {
            const has = !!getPat();
            input.placeholder = has ? '(saved — paste a new one to replace)' : 'Personal access token (ghp_… or github_pat_…)';
            status.textContent = has ? 'Token saved in this browser.' : 'No token set.';
            status.className = 'status ' + (has ? 'saved' : 'dirty');
        };
        saveBtn.addEventListener('click', () => {
            const v = input.value.trim();
            if (!v) { refresh(); return; }
            setPat(v);
            input.value = '';
            refresh();
        });
        clearBtn.addEventListener('click', () => {
            setPat('');
            input.value = '';
            refresh();
        });
        refresh();
    }

    async function init() {
        grid = document.getElementById('grid');
        statusEl = document.getElementById('status');

        loadEdits();

        try {
            const [data, caps] = await Promise.all([
                fetchJSON('/data/instagram.json'),
                fetchJSON('/data/instagram_captions.json').catch(() => ({})),
            ]);
            items = Array.isArray(data) ? data : [];
            baseCaptions = caps || {};
        } catch (e) {
            grid.innerHTML = `<div class="empty">Failed to load data: ${escapeHTML(e.message)}</div>`;
            return;
        }

        renderAll();
        updateStatus();
        // Apply the initial filter pass so hidden rows are actually hidden
        // by default. Without this, all rows render with display:'' and the
        // .is-hidden CSS class only dims them — making the "Show hidden"
        // toggle look like a no-op on its first click (the rows are already
        // visible). After this call, the default state is "hidden rows are
        // hidden" and toggling "Show hidden" reveals them.
        applyFilters();

        grid.addEventListener('input', handleInput);
        grid.addEventListener('change', handleInput);

        // Copy/Download YAML buttons were the manual fallback before the
        // proxy existed. Bind if present, skip silently if the simpler
        // header has removed them.
        document.getElementById('copy-btn')?.addEventListener('click', copyYAML);
        document.getElementById('download-btn')?.addEventListener('click', downloadYAML);
        document.getElementById('discard-btn').addEventListener('click', discardEdits);
        document.getElementById('sync-btn').addEventListener('click', syncToGitHub);

        // Crop editor: open on thumb click OR explicit Crop button.
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-crop-edit]');
            if (btn) {
                openCropEditor(btn.dataset.cropEdit);
                return;
            }
            const trigger = e.target.closest('[data-crop-trigger]');
            if (trigger) {
                const row = trigger.closest('.photo');
                if (row) openCropEditor(row.dataset.id);
            }
        });

        wireCropEditorButtons();
        wireGhSettings();

        const filter = () => applyFilters();
        document.getElementById('search').addEventListener('input', filter);
        document.getElementById('only-edited').addEventListener('change', filter);
        document.getElementById('only-missing').addEventListener('change', filter);
        document.getElementById('show-hidden').addEventListener('change', filter);
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
