// content_script.updated.js — Prompt + Answer paired modal list
// Based on the original file provided by the user (content_script.js).
// This version pairs each user prompt with its following assistant answer (if present)
// and renders the list as: "1. Prompt" followed by "Answer 1".

console.log("✅ Prompt History Extension (paired prompt->answer) starting...");

(function () {
    // --- Site Configuration (keep same defaults) ---
    const siteConfigs = {
        'chatgpt.com': {
            userMessageContainer: 'div[data-message-author-role="user"]',
            userMessageText: 'div.text-base, div[class*="markdown"] p, p',
            conversationContainer: 'main'
        },
        'chat.openai.com': null,
        'gemini.google.com': {
            userMessageContainer: '.user-query',
            userMessageText: '.query-text, .query-text-line, [class*="query-text"]',
            conversationContainer: '.conversation-container'
        }
    };

    siteConfigs['chat.openai.com'] = siteConfigs['chatgpt.com'];
    const siteKey = Object.keys(siteConfigs).find(k => window.location.hostname.includes(k));
    const SELECTORS = siteConfigs[siteKey] || siteConfigs['chatgpt.com'];

    // --- DOM IDs ---
    const MODAL_ID = 'prompt-history-modal';
    const TOGGLE_ID = 'prompt-history-toggle';
    const LIST_ID = 'prompt-history-list';
    const OVERLAY_ID = 'prompt-history-overlay';
    const CLOSE_BTN_ID = 'prompt-history-close-btn';

    const SNIPPET_LENGTH = 160;
    const HIGHLIGHT_MS = 2000;
    let idCounter = 0;
    let debounceTimer = null;
    let cachedList = null;
    let lastPairCount = 0;

    // --- Inject small CSS for answer items so we don't require a CSS file change ---
    function injectInlineStyles() {
        if (document.getElementById('prompt-history-inline-styles')) return;
        const style = document.createElement('style');
        style.id = 'prompt-history-inline-styles';
        style.textContent = `
            .answer-item { display: flex; gap: 12px; padding: 8px 20px; border-radius: 8px; cursor: pointer; opacity: 0.95; font-size: 14px; color: var(--text-secondary, #bdbdbd); }
            .answer-item:hover { background-color: rgba(255,255,255,0.02); transform: translateY(-1px); }
            .answer-label { font-weight: 600; margin-right: 8px; color: var(--text-secondary, #9aa0a6); }
            .answer-snippet { word-break: break-word; }
            .answer-highlight { background-color: rgba(16,185,129,0.08) !important; border-radius: 8px; box-shadow: 0 0 0 2px rgba(16,185,129,0.12); }
        `;
        document.head.appendChild(style);
    }

    // --- Create modal UI ---
    function createModalUI() {
        if (document.getElementById(MODAL_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        const modal = document.createElement('div');
        modal.id = MODAL_ID;

        const header = document.createElement('div');
        header.className = 'prompt-modal-header';

        const title = document.createElement('h2');
        title.className = 'prompt-modal-title';
        title.textContent = 'Prompt History';

        const closeBtn = document.createElement('button');
        closeBtn.id = CLOSE_BTN_ID;
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close');

        header.appendChild(title);
        header.appendChild(closeBtn);

        const list = document.createElement('ul');
        list.id = LIST_ID;

        const toggleBtn = document.createElement('button');
        toggleBtn.id = TOGGLE_ID;
        toggleBtn.setAttribute('aria-label', 'View Prompt History');
        toggleBtn.innerHTML = `📜`;

        modal.appendChild(header);
        modal.appendChild(list);
        document.body.appendChild(overlay);
        document.body.appendChild(modal);
        document.body.appendChild(toggleBtn);

        cachedList = list;

        const openModal = () => document.body.classList.add('prompt-modal-visible');
        const closeModal = () => document.body.classList.remove('prompt-modal-visible');

        toggleBtn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal);
    }

    // --- Read all message nodes with a role attribute and build ordered array ---
    function readOrderedMessages() {
        const nodeList = Array.from(document.querySelectorAll('[data-message-author-role]'));
        if (!nodeList.length) return [];

        // Map to {role, el, text}
        const msgs = nodeList.map((el) => {
            const role = el.getAttribute('data-message-author-role') || 'user';
            // try to find inner text
            const inner = el.querySelector(SELECTORS.userMessageText) || el;
            const text = (inner && inner.textContent ? inner.textContent.trim().replace(/\s+/g, ' ') : '').slice(0, 5000);
            return { role, el, text };
        }).filter(m => m.text && m.text.length);

        return msgs;
    }

    // --- Build prompt->answer pairs ---
    function buildPairs() {
        const msgs = readOrderedMessages();
        if (!msgs.length) return [];

        const pairs = [];
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m.role === 'user') {
                // find next assistant message
                let answer = null;
                if (i + 1 < msgs.length && msgs[i + 1].role === 'assistant') {
                    answer = msgs[i + 1];
                } else {
                    // in some flows assistant might appear later; scan forward until next assistant
                    for (let j = i + 1; j < msgs.length; j++) {
                        if (msgs[j].role === 'assistant') { answer = msgs[j]; break; }
                        if (msgs[j].role === 'user') break; // next user indicates no assistant for this prompt
                    }
                }

                pairs.push({ prompt: m, answer });
            }
        }

        return pairs;
    }

    // --- Create snippet helper ---
    function snippetOf(text, max = SNIPPET_LENGTH) {
        if (!text) return '';
        return text.length > max ? text.slice(0, max) + '…' : text;
    }

    // --- Sync pairs to modal list ---
    function syncPrompts() {
        if (!cachedList) cachedList = document.getElementById(LIST_ID);
        if (!cachedList) return;

        injectInlineStyles();

        const pairs = buildPairs();

        if (pairs.length === lastPairCount && pairs.length > 0) return;
        lastPairCount = pairs.length;

        const fragment = document.createDocumentFragment();

        if (!pairs.length) {
            cachedList.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'prompt-item empty';
            li.textContent = 'No prompts found in this chat yet.';
            fragment.appendChild(li);
        } else {
            cachedList.innerHTML = '';

            pairs.forEach((p, idx) => {
                // ensure dataset ids on elements
                if (!p.prompt.el.dataset.promptId) p.prompt.el.dataset.promptId = `prompt-${++idCounter}`;
                const promptId = p.prompt.el.dataset.promptId;

                // Prompt list item
                const liPrompt = document.createElement('li');
                liPrompt.className = 'prompt-item';
                liPrompt.tabIndex = 0;
                liPrompt.dataset.targetId = promptId;
                liPrompt.title = p.prompt.text;

                const num = document.createElement('span');
                num.className = 'prompt-number';
                num.textContent = `${idx + 1}.`;

                const snip = document.createElement('span');
                snip.className = 'prompt-snippet';
                snip.textContent = snippetOf(p.prompt.text);

                liPrompt.appendChild(num);
                liPrompt.appendChild(snip);

                const activatePrompt = () => {
                    const target = document.querySelector(`[data-prompt-id='${promptId}']`);
                    if (!target) return;
                    document.body.classList.remove('prompt-modal-visible');
                    requestAnimationFrame(() => {
                        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => {
                            target.classList.add('prompt-highlight');
                            setTimeout(() => target.classList.remove('prompt-highlight'), HIGHLIGHT_MS);
                        }, 300);
                    });
                };

                liPrompt.addEventListener('click', activatePrompt);
                liPrompt.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activatePrompt(); } });

                fragment.appendChild(liPrompt);

                // Answer item (if present)
                if (p.answer) {
                    if (!p.answer.el.dataset.answerId) p.answer.el.dataset.answerId = `answer-${++idCounter}`;
                    const answerId = p.answer.el.dataset.answerId;

                    const liAnswer = document.createElement('li');
                    liAnswer.className = 'answer-item';
                    liAnswer.tabIndex = 0;
                    liAnswer.dataset.targetId = answerId;
                    liAnswer.title = p.answer.text;

                    const label = document.createElement('span');
                    label.className = 'answer-label';
                    label.textContent = `Answer ${idx + 1}`;

                    const ansSnip = document.createElement('span');
                    ansSnip.className = 'answer-snippet';
                    ansSnip.textContent = snippetOf(p.answer.text, 120);

                    liAnswer.appendChild(label);
                    liAnswer.appendChild(ansSnip);

                    const activateAnswer = () => {
                        const target = document.querySelector(`[data-answer-id='${answerId}']`);
                        if (!target) return;
                        document.body.classList.remove('prompt-modal-visible');
                        requestAnimationFrame(() => {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            setTimeout(() => {
                                target.classList.add('answer-highlight');
                                setTimeout(() => target.classList.remove('answer-highlight'), HIGHLIGHT_MS);
                            }, 300);
                        });
                    };

                    liAnswer.addEventListener('click', activateAnswer);
                    liAnswer.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activateAnswer(); } });

                    fragment.appendChild(liAnswer);
                }
            });
        }

        cachedList.appendChild(fragment);
    }

    // --- Observe conversation container changes ---
    function startObserver() {
        const containerSelector = SELECTORS?.conversationContainer || 'main';
        const container = document.querySelector(containerSelector);
        if (!container) {
            setTimeout(startObserver, 500);
            return;
        }

        syncPrompts();

        const mo = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                try { syncPrompts(); } catch (e) { console.error('Sync failed:', e); }
            }, 800);
        });

        mo.observe(container, { childList: true, subtree: true });
    }

    // --- Init ---
    function init() {
        try {
            createModalUI();
            startObserver();
            setInterval(syncPrompts, 3500);
            console.log('✅ Prompt History (paired) initialized');
        } catch (e) {
            console.error('Prompt History init failed', e);
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 150);
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
