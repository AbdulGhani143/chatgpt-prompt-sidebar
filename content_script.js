// content_script.js — Revamped with a floating modal window

console.log("✅ Prompt History Extension starting...");

(function () {
    // --- Site Configuration (Unchanged) ---
    const siteConfigs = {
        'chatgpt.com': {
            userMessageContainer: 'div[data-message-author-role="user"]',
            userMessageText: 'div.text-base, div[class*="markdown"] p, p',
            conversationContainer: 'main'
        },
        'chat.openai.com': null, // Alias
        'gemini.google.com': {
            userMessageContainer: '.user-query',
            userMessageText: '.query-text, .query-text-line, [class*="query-text"]',
            conversationContainer: '.conversation-container'
        }
    };

    siteConfigs['chat.openai.com'] = siteConfigs['chatgpt.com'];
    const siteKey = Object.keys(siteConfigs).find(k => window.location.hostname.includes(k));
    const SELECTORS = siteConfigs[siteKey] || siteConfigs['chatgpt.com'];

    // --- New DOM IDs for Modal UI ---
    const MODAL_ID = 'prompt-history-modal';
    const TOGGLE_ID = 'prompt-history-toggle';
    const LIST_ID = 'prompt-history-list';
    const OVERLAY_ID = 'prompt-history-overlay';
    const CLOSE_BTN_ID = 'prompt-history-close-btn';

    // --- Constants ---
    const SNIPPET_LENGTH = 160;
    const HIGHLIGHT_MS = 2000;
    let promptIdCounter = 0;
    let debounceTimer = null;
    let cachedList = null;
    let lastMessageCount = 0;

    // --- NEW: Create Modal UI ---
    function createModalUI() {
        if (document.getElementById(MODAL_ID)) return;

        // Modal Overlay (for background dimming)
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        // Main Modal Container
        const modal = document.createElement('div');
        modal.id = MODAL_ID;

        // Header
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

        // Prompt List
        const list = document.createElement('ul');
        list.id = LIST_ID;

        // Floating Action Button (FAB) to open the modal
        const toggleBtn = document.createElement('button');
        toggleBtn.id = TOGGLE_ID;
        toggleBtn.setAttribute('aria-label', 'View Prompt History');
        // Simple icon for the button
        toggleBtn.innerHTML = `📜`;

        // Append elements to body
        modal.appendChild(header);
        modal.appendChild(list);
        document.body.appendChild(overlay);
        document.body.appendChild(modal);
        document.body.appendChild(toggleBtn);

        // Cache the list element
        cachedList = list;

        // --- NEW: Event Listeners for Modal ---
        const openModal = () => document.body.classList.add('prompt-modal-visible');
        const closeModal = () => document.body.classList.remove('prompt-modal-visible');

        toggleBtn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal); // Click outside to close
    }

    // --- Find User Messages (Optimized) ---
    function findUserMessages() {
        if (!SELECTORS || !SELECTORS.userMessageContainer) return [];

        const nodeList = Array.from(document.querySelectorAll(SELECTORS.userMessageContainer));
        if (!nodeList.length) return [];

        const messages = nodeList.map((el, index) => {
            let textEl = el.querySelector(SELECTORS.userMessageText);
            const txt = (textEl ? textEl.textContent : el.textContent || '').trim().replace(/\s+/g, ' ');
            
            // Use DOM order instead of getBoundingClientRect to avoid layout thrashing
            return { el, text: txt, index };
        }).filter(m => m.text && m.text.length);

        // Sort by DOM order instead of position
        messages.sort((a, b) => a.index - b.index);
        return messages;
    }

    // --- Sync Prompts to List (Optimized for Performance) ---
    function syncPrompts() {
        if (!cachedList) {
            cachedList = document.getElementById(LIST_ID);
        }
        if (!cachedList) return;

        const messages = findUserMessages();
        
        // Only update if the count changed
        if (messages.length === lastMessageCount && messages.length > 0) {
            return; // No changes needed
        }
        
        lastMessageCount = messages.length;

        // Use DocumentFragment to reduce reflow
        const fragment = document.createDocumentFragment();

        if (!messages.length) {
            cachedList.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'prompt-item empty';
            li.textContent = 'No prompts found in this chat yet.';
            fragment.appendChild(li);
        } else {
            cachedList.innerHTML = '';
            
            messages.forEach((m, idx) => {
                if (!m.el.dataset.promptId) m.el.dataset.promptId = `prompt-sync-${++promptIdCounter}`;
                m.id = m.el.dataset.promptId;

                const li = document.createElement('li');
                li.className = 'prompt-item';
                li.tabIndex = 0;
                li.dataset.targetId = m.id;
                li.title = m.text;

                const num = document.createElement('span');
                num.className = 'prompt-number';
                num.textContent = `${idx + 1}.`;

                const snip = document.createElement('span');
                snip.className = 'prompt-snippet';
                snip.textContent = m.text.length > SNIPPET_LENGTH ? `${m.text.slice(0, SNIPPET_LENGTH)}…` : m.text;

                li.appendChild(num);
                li.appendChild(snip);

                const activate = () => {
                    const target = document.querySelector(`[data-prompt-id='${m.id}']`);
                    if (!target) return;

                    document.body.classList.remove('prompt-modal-visible');
                    
                    // Use requestAnimationFrame for smoother animations
                    requestAnimationFrame(() => {
                        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        
                        // Add delay before highlight to ensure scroll completes
                        setTimeout(() => {
                            target.classList.add('prompt-highlight');
                            setTimeout(() => target.classList.remove('prompt-highlight'), HIGHLIGHT_MS);
                        }, 300);
                    });
                };

                li.addEventListener('click', activate);
                li.addEventListener('keydown', (ev) => { 
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        activate();
                    }
                });

                fragment.appendChild(li);
            });
        }
        
        cachedList.appendChild(fragment);
    }

    // --- Observe Conversation for Changes ---
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
                try { 
                    syncPrompts(); 
                } catch (e) { 
                    console.error('Sync failed:', e); 
                }
            }, 1000); // Increased debounce time for better performance
        });

        // More specific observer to reduce unnecessary triggers
        mo.observe(container, { childList: true, subtree: false });
    }

    // --- Initialization ---
    function init() {
        try {
            createModalUI();
            startObserver();
            setInterval(syncPrompts, 4000); // Periodic refresh as a fallback
            console.log('✅ Prompt History Modal initialized');
        } catch (e) {
            console.error('Prompt History Modal init failed', e);
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 150);
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
