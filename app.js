/**
 * FlipBuilder Audio Extractor - Logic Engine
 * Final Version - Extremely Robust with Fail-safes
 */

document.addEventListener('DOMContentLoaded', () => {
    const extractBtn = document.getElementById('extractBtn');
    const targetUrlInput = document.getElementById('targetUrl');
    const audioList = document.getElementById('audioList');
    const totalAudiosEl = document.getElementById('totalAudios');
    const totalPagesEl = document.getElementById('totalPages');
    const statusEl = document.getElementById('extractionStatus');
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const themeToggle = document.getElementById('themeToggle');
    const audioPreview = document.getElementById('audioPreview');

    let extractedData = [];
    let currentParts = [];

    // --- Theme Management ---
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const icon = themeToggle.querySelector('i');
        icon.className = document.body.classList.contains('light-theme') ? "fas fa-sun" : "fas fa-moon";
    });

    // --- Manual Fallback Logic ---
    const manualInputBtn = document.getElementById('manualInputBtn');
    const manualArea = document.getElementById('manualArea');
    const parseManualBtn = document.getElementById('parseManualBtn');
    const manualConfigText = document.getElementById('manualConfigText');

    manualInputBtn.addEventListener('click', () => {
        const isHidden = manualArea.style.display === 'none';
        manualArea.style.display = isHidden ? 'block' : 'none';
        manualInputBtn.innerHTML = isHidden ? 'Đóng nhâp liệu <i class="fas fa-times"></i>' : 'Nhập thủ công <i class="fas fa-edit"></i>';
    });

    parseManualBtn.addEventListener('click', () => {
        const content = manualConfigText.value.trim();
        const rawUrl = targetUrlInput.value.trim();
        
        if (!rawUrl || !rawUrl.startsWith('http')) {
            alert('Vui lòng nhập Link trang web FlipBuilder gốc vào ô tìm kiếm ở trên trước khi bấm Phân tích thủ công (Để ứng dụng biết địa chỉ máy chủ của bạn)!');
            return;
        }

        const baseUrl = cleanBaseUrl(rawUrl);
        if (!content) return showToast('Vui lòng dán nội dung config.js!', 'error');

        try {
            statusEl.innerText = 'Đang phân tích thủ công...';
            const pageEditor = parseVariable(content, 'pageEditor');
            const bmtConfig = parseVariable(content, 'bmtConfig');
            if (!pageEditor) throw new Error('Không tìm thấy dữ liệu pageEditor.');
            extractedData = processAudioData(pageEditor, bmtConfig, baseUrl);
            renderResults(extractedData);

            const totalPages = pageEditor.pageAnnos ? pageEditor.pageAnnos.length : 0;
            const parts = detectPartsFromBookmarks(bmtConfig, totalPages);
            currentParts = groupAudiosByPart(extractedData, parts);
            renderPartSection(currentParts);

            totalAudiosEl.innerText = extractedData.length;
            totalPagesEl.innerText = totalPages || '0';
            statusEl.innerText = 'Hoàn tất (Thủ công)';
            showToast('Phân tích thủ công thành công!', 'success');
            manualArea.style.display = 'none';
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // --- Core Data Fetcher with Proxy Rotation & Direct Fallback ---
    async function fetchWithProxy(url, isRaw = false) {
        // 1. Direct (works if server has CORS headers)
        try {
            const resp = await fetch(url);
            if (resp.ok) return isRaw ? await resp.blob() : await resp.text();
        } catch (e) { /* CORS blocked */ }

        // 2. Proxies - ordered by reliability for binary files
        const proxies = isRaw ? [
            `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        ] : [
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
            `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
            `https://thingproxy.freeboard.io/fetch/${url}`,
        ];

        let lastError;
        for (const pUrl of proxies) {
            try {
                statusEl.innerText = `Thử ${new URL(pUrl).hostname}...`;
                const resp = await fetch(pUrl, { signal: AbortSignal.timeout(15000) });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                if (isRaw) {
                    const blob = await resp.blob();
                    if (blob.size === 0) throw new Error('Empty response');
                    return blob;
                }
                if (pUrl.includes('allorigins.win/get')) {
                    const data = await resp.json();
                    return data.contents;
                }
                return await resp.text();
            } catch (e) {
                lastError = e;
            }
        }
        throw new Error(lastError?.message || 'Tất cả proxy thất bại');
    }

    // --- Core Logic ---
    extractBtn.addEventListener('click', async () => {
        let rawUrl = targetUrlInput.value.trim();
        if (!rawUrl) return showToast('Vui lòng nhập URL!', 'error');
        startLoading();
        try {
            const baseUrl = cleanBaseUrl(rawUrl);
            const configUrl = `${baseUrl}mobile/javascript/config.js`;
            const scriptContent = await fetchWithProxy(configUrl);
            const pageEditor = parseVariable(scriptContent, 'pageEditor');
            const bmtConfig = parseVariable(scriptContent, 'bmtConfig');
            if (!pageEditor) throw new Error('Không thể phân tích dữ liệu tệp cấu hình.');
            extractedData = processAudioData(pageEditor, bmtConfig, baseUrl);
            renderResults(extractedData);

            const totalPages = pageEditor.pageAnnos ? pageEditor.pageAnnos.length : 0;
            const parts = detectPartsFromBookmarks(bmtConfig, totalPages);
            currentParts = groupAudiosByPart(extractedData, parts);
            renderPartSection(currentParts);

            totalAudiosEl.innerText = extractedData.length;
            totalPagesEl.innerText = totalPages || 'Đã ẩn';
            statusEl.innerText = 'Hoàn tất';
            showToast(`Tìm thấy ${extractedData.length} tệp!`, 'success');
        } catch (error) {
            alert('Lỗi: ' + error.message + '\n\nHãy thử dùng tính năng "Nhập thủ công" bên dưới.');
            resetUI();
        } finally {
            stopLoading();
        }
    });

    // --- Helper Functions ---
    function cleanBaseUrl(url) {
        let clean = url.split('?')[0].split('#')[0];
        clean = clean.replace(/\/(config\.js|index\.html|index\.htm)$/i, '');
        clean = clean.replace(/\/mobile\/javascript(\/)?$/i, '');
        if (!clean.endsWith('/')) clean += '/';
        return clean;
    }

    function parseVariable(content, varName) {
        try {
            const regex = new RegExp(`${varName}\\s*=\\s*({[\\s\\S]*?});|${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`, 'm');
            const match = content.match(regex);
            if (match) {
                const jsonStr = match[1] || match[2];
                return Function('"use strict";return (' + jsonStr.replace(/;\s*$/, '') + ')')();
            }
        } catch (e) {}
        return null;
    }

    function processAudioData(pageEditor, bmtConfig, baseUrl) {
        const results = [];
        const bookmarks = bmtConfig || [];
        if (!pageEditor.pageAnnos) return results;
        pageEditor.pageAnnos.forEach((annos, index) => {
            if (!annos) return;
            annos.forEach(anno => {
                if (anno.annotype === "com.mobiano.flipbook.pageeditor::TAnnoPlugIn" && 
                    anno.componentData && anno.componentData.songs) {
                    const song = anno.componentData.songs.song;
                    if (song && song.url) {
                        const pageNum = index + 1;
                        let title = `Âm thanh trang ${pageNum}`;
                        const matchingBmt = bookmarks.find(b => b.pageIndex === index);
                        if (matchingBmt) title = matchingBmt.title;
                        const relativePath = song.url.startsWith('./') ? song.url.substring(2) : song.url;
                        const fullUrl = encodeURI(baseUrl + relativePath);
                        results.push({
                            id: results.length + 1,
                            title: title,
                            originalName: decodeURIComponent(relativePath.split('/').pop().split('?')[0]),
                            pageNum: pageNum,
                            url: fullUrl
                        });
                    }
                }
            });
        });
        return results;
    }

    function renderResults(data) {
        if (data.length === 0) {
            audioList.innerHTML = `<tr><td colspan="5" class="empty-state">Không tìm thấy âm thanh.</td></tr>`;
            return;
        }
        audioList.innerHTML = data.map(item => `
            <tr class="fade-in">
                <td>${item.id}</td>
                <td class="font-bold">${item.title}</td>
                <td class="text-secondary"><small>${item.originalName}</small></td>
                <td><span class="badge">Trang ${item.pageNum}</span></td>
                <td>
                    <div class="action-btns">
                        <a href="${item.url}" target="_blank" class="control-btn link-btn" title="Mở âm thanh">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // --- Global Handlers ---
    window.previewAudio = async (url, btn) => {
        const icon = btn.querySelector('i');
        if (audioPreview.src.startsWith('blob:') && !audioPreview.paused) {
            audioPreview.pause();
            icon.className = "fas fa-play";
            return;
        }
        document.querySelectorAll('.play-btn i').forEach(i => i.className = "fas fa-play");
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        statusEl.innerText = 'Đang tải âm thanh...';

        try {
            const blob = await fetchWithProxy(url, true);
            const blobUrl = window.URL.createObjectURL(blob);
            audioPreview.src = blobUrl;
            audioPreview.play();
            btn.innerHTML = '<i class="fas fa-pause"></i>';
            statusEl.innerText = 'Đang phát';
            audioPreview.onended = () => {
                btn.innerHTML = '<i class="fas fa-play"></i>';
                window.URL.revokeObjectURL(blobUrl);
            };
        } catch (e) {
            btn.innerHTML = '<i class="fas fa-play"></i>';
            statusEl.innerText = 'Lỗi phát nhạc';
            // If proxy fails, try DIRECT play as last resort
            showToast('Proxy lỗi, thử phát trực tiếp...', 'info');
            audioPreview.src = url;
            audioPreview.play().catch(() => {
                alert('Không thể phát file này. Hãy nhấn nút "Mở trực tiếp" bên cạnh để nghe.');
            });
        }
    };

    window.downloadFile = async (url, filename, btn) => {
        const oIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            const blob = await fetchWithProxy(url, true);
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            showToast('Tải xong!', 'success');
        } catch (e) {
            window.open(url, '_blank');
            showToast('Đang mở file trực tiếp...', 'info');
        } finally {
            btn.innerHTML = oIcon; btn.disabled = false;
        }
    };

    function showOpenLinksBtn(group, nearBtn) {
        const existing = nearBtn.parentElement.querySelector('.open-links-btn');
        if (existing) return;
        const fallback = document.createElement('button');
        fallback.className = 'btn-download-part open-links-btn';
        fallback.style.setProperty('--part-color', '#e17055');
        fallback.style.marginTop = '6px';
        fallback.innerHTML = '<i class="fas fa-external-link-alt"></i> Mở tất cả links';
        fallback.onclick = () => {
            group.audios.forEach((audio, i) => {
                setTimeout(() => window.open(audio.url, '_blank'), i * 400);
            });
            showToast(`Đã mở ${group.audios.length} tab. Nhấn Ctrl+S trên mỗi tab để lưu.`, 'info');
        };
        nearBtn.parentElement.appendChild(fallback);
    }

    function startLoading() { extractBtn.disabled = true; extractBtn.classList.add('loading'); }
    function stopLoading() { extractBtn.disabled = false; extractBtn.classList.remove('loading'); }
    function resetUI() { audioList.innerHTML = ''; }

    function showToast(msg, type) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const colors = { success: '#00b894', error: '#d63031', info: '#74b9ff' };
        const toast = document.createElement('div');
        toast.style.cssText = `background:${colors[type]||'#636e72'};color:white;padding:12px 20px;border-radius:12px;font-size:.9rem;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.3);animation:fadeIn .3s ease-out;max-width:320px;`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }

    function detectPartsFromBookmarks(bmtConfig, totalPages) {
        if (!bmtConfig || bmtConfig.length === 0) return null;

        const sorted = [...bmtConfig].sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));
        const hasChildren = bmtConfig.some(b => b.children && b.children.length > 0);

        if (!hasChildren) {
            // Flat: mỗi bookmark là một part
            return sorted.map((bmt, i) => ({
                title: bmt.title || `Part ${i + 1}`,
                section: null,
                startPage: (bmt.pageIndex || 0) + 1,
                endPage: sorted[i + 1] ? sorted[i + 1].pageIndex : (totalPages || 99999)
            }));
        }

        // Nested: top-level = section, children = part
        const parts = [];
        sorted.forEach((section, si) => {
            const nextSection = sorted[si + 1];
            const sectionEnd = nextSection ? nextSection.pageIndex : (totalPages || 99999);

            if (section.children && section.children.length > 0) {
                const children = [...section.children].sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));
                children.forEach((child, ci) => {
                    parts.push({
                        title: child.title || `Part ${ci + 1}`,
                        section: section.title,
                        startPage: (child.pageIndex || 0) + 1,
                        endPage: children[ci + 1] ? children[ci + 1].pageIndex : sectionEnd
                    });
                });
            } else {
                parts.push({
                    title: section.title || `Phần ${si + 1}`,
                    section: null,
                    startPage: (section.pageIndex || 0) + 1,
                    endPage: sectionEnd
                });
            }
        });
        return parts;
    }

    function groupAudiosByPart(audios, parts) {
        if (!parts || parts.length <= 1) {
            return audios.length > 0 ? [{ title: 'Tất cả', section: null, audios }] : [];
        }
        const groups = parts.map(p => ({ title: p.title, section: p.section, startPage: p.startPage, endPage: p.endPage, audios: [] }));
        const ungrouped = [];
        audios.forEach(audio => {
            const g = groups.find(g => audio.pageNum >= g.startPage && audio.pageNum <= g.endPage);
            g ? g.audios.push(audio) : ungrouped.push(audio);
        });
        if (ungrouped.length > 0) groups.push({ title: 'Khác', section: null, audios: ungrouped });
        return groups.filter(g => g.audios.length > 0);
    }

    function renderPartSection(groups) {
        const partSection = document.getElementById('partSection');
        if (!partSection || !groups || groups.length <= 1) {
            if (partSection) partSection.style.display = 'none';
            return;
        }

        const palette = ['#ff759f','#6c5ce7','#00b894','#fdcb6e','#e17055','#74b9ff','#fd79a8','#a29bfe','#55efc4','#fab1a0','#ff7675','#dfe6e9'];
        const hasSections = groups.some(g => g.section);
        partSection.style.display = 'block';

        let bodyHtml;
        if (hasSections) {
            // Gom theo section rồi render từng nhóm
            const sectionMap = new Map();
            groups.forEach((g, i) => {
                const key = g.section || '—';
                if (!sectionMap.has(key)) sectionMap.set(key, []);
                sectionMap.get(key).push({ ...g, index: i });
            });

            const sectionColors = ['#ff759f','#6c5ce7','#00b894','#fdcb6e','#e17055'];
            let si = 0;
            bodyHtml = [...sectionMap.entries()].map(([sectionName, parts]) => {
                const sColor = sectionColors[si++ % sectionColors.length];
                const partsHtml = parts.map((g, pi) => `
                    <div class="part-card" style="--part-color:${palette[(si * 3 + pi) % palette.length]}">
                        <div class="part-header">
                            <div class="part-icon"><i class="fas fa-folder-open"></i></div>
                            <div class="part-info">
                                <h3 class="part-title">${g.title}</h3>
                                <span>${g.audios.length} file MP3</span>
                            </div>
                        </div>
                        <button class="btn-download-part" onclick="downloadPart(${g.index}, this)">
                            <i class="fas fa-file-archive"></i> Tải ZIP
                        </button>
                    </div>
                `).join('');
                return `
                    <div class="section-group">
                        <div class="section-group-header" style="--sg-color:${sColor}">
                            <i class="fas fa-book-open"></i> ${sectionName}
                        </div>
                        <div class="parts-grid">${partsHtml}</div>
                    </div>
                `;
            }).join('');
        } else {
            bodyHtml = `<div class="parts-grid">
                ${groups.map((g, i) => `
                    <div class="part-card" style="--part-color:${palette[i % palette.length]}">
                        <div class="part-header">
                            <div class="part-icon"><i class="fas fa-folder-open"></i></div>
                            <div class="part-info">
                                <h3 class="part-title">${g.title}</h3>
                                <span>${g.audios.length} file MP3</span>
                            </div>
                        </div>
                        <button class="btn-download-part" onclick="downloadPart(${i}, this)">
                            <i class="fas fa-file-archive"></i> Tải ZIP
                        </button>
                    </div>
                `).join('')}
            </div>`;
        }

        partSection.innerHTML = `
            <div class="section-header">
                <h2><i class="fas fa-layer-group"></i> Tải theo Part</h2>
                <span class="badge">${groups.length} part · ${hasSections ? [...new Set(groups.map(g=>g.section).filter(Boolean))].length + ' phần' : ''}</span>
            </div>
            ${bodyHtml}
        `;
    }

    window.downloadPart = async (groupIndex, btn) => {
        const group = currentParts[groupIndex];
        if (!group || group.audios.length === 0) return;
        const oHtml = btn.innerHTML;
        btn.disabled = true;

        if (typeof JSZip === 'undefined') {
            showToast('JSZip chưa tải, mở từng link...', 'info');
            for (const audio of group.audios) window.open(audio.url, '_blank');
            btn.disabled = false;
            return;
        }

        try {
            const zip = new JSZip();
            const folderName = group.title.replace(/[<>:"/\\|?*]/g, '_');
            const folder = zip.folder(folderName);
            let ok = 0, fail = 0;

            for (let i = 0; i < group.audios.length; i++) {
                const audio = group.audios[i];
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${i + 1}/${group.audios.length}`;
                try {
                    const blob = await fetchWithProxy(audio.url, true);
                    // Verify it's actually audio (not an error HTML page)
                    if (blob.type && blob.type.includes('text/html')) throw new Error('Proxy trả về HTML');
                    folder.file(audio.originalName, blob);
                    ok++;
                } catch (e) {
                    fail++;
                    console.warn(`✗ ${audio.originalName}:`, e.message);
                }
            }

            if (ok === 0) {
                showToast('Không tải được file nào. Server chặn CORS — dùng nút "Mở Links" bên dưới.', 'error');
                btn.innerHTML = oHtml; btn.disabled = false;
                // Show fallback open-links button
                showOpenLinksBtn(group, btn);
                return;
            }

            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang nén...';
            const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
            const blobUrl = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = `${folderName}.zip`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            if (fail > 0) showToast(`Tải ${ok}/${group.audios.length} file (${fail} lỗi proxy).`, 'info');
            else showToast(`Tải xong "${group.title}" — ${ok} file!`, 'success');
        } catch (e) {
            showToast('Lỗi: ' + e.message, 'error');
        } finally {
            btn.innerHTML = oHtml;
            btn.disabled = false;
        }
    };
});
