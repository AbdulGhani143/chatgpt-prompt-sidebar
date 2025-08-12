console.log("✅ ChatGPT Sidebar Extension is starting...");

// This wrapper function ensures our code only runs after the page body is ready.
function runExtension() {
    // --- Configuration & Selectors ---
    const SELECTORS = {
        conversationTurn: 'div[data-testid^="conversation-turn-"]',
        userMessageContainer: '[data-message-author-role="user"]',
        userMessageText: 'div[data-message-author-role="user"] .text-token-text-primary',
        conversationContainer: 'main',
    };
    const SNIPPET_LENGTH = 160;
    const HIGHLIGHT_DURATION_MS = 2000;

    let promptIdCounter = 0;

    function createSidebar() {
        // Prevent creating duplicate elements
        if (document.getElementById('chatgpt-prompt-sidebar')) return;

        const sidebar = document.createElement('div');
        sidebar.id = 'chatgpt-prompt-sidebar';
        sidebar.className = 'chatgpt-prompt-sidebar';
        
        const title = document.createElement('h2');
        title.id = 'chatgpt-sidebar-title';
        title.textContent = 'Prompt History';

        const list = document.createElement('ul');
        list.id = 'chatgpt-prompt-list';
        const toggleButton = document.createElement('button');
        toggleButton.id = 'chatgpt-sidebar-toggle';
        toggleButton.textContent = '›';

        sidebar.appendChild(title);
        sidebar.appendChild(list);
        document.body.appendChild(sidebar);
        document.body.appendChild(toggleButton);

        toggleButton.addEventListener('click', () => {
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            toggleButton.textContent = isCollapsed ? '‹' : '›';
            chrome.storage.local.set({ sidebarIsCollapsed: isCollapsed });
        });

        chrome.storage.local.get('sidebarIsCollapsed', (data) => {
            if (data.sidebarIsCollapsed) {
                document.body.classList.add('sidebar-collapsed');
                toggleButton.textContent = '‹';
            }
        });
    }

    function syncSidebar() {
        const sidebarList = document.getElementById('chatgpt-prompt-list');
        if (!sidebarList) return;
        sidebarList.innerHTML = '';
        const promptElements = document.querySelectorAll(SELECTORS.userMessageContainer);

        promptElements.forEach((promptEl, index) => {
            const textElement = promptEl.querySelector('div:last-child > div:first-child');
            if (!textElement) return;

            if (!promptEl.dataset.promptId) {
                promptEl.dataset.promptId = `prompt-sync-${promptIdCounter++}`;
            }
            const promptId = promptEl.dataset.promptId;
            const fullText = textElement.textContent || '';
            if (fullText.trim() === '') return;

            const snippet = fullText.length > SNIPPET_LENGTH ?
                fullText.substring(0, SNIPPET_LENGTH) + '...' :
                fullText;

            const listItem = document.createElement('li');
            listItem.textContent = `${index + 1}. ${snippet}`;
            listItem.title = fullText;
            listItem.dataset.targetId = promptId;

            listItem.addEventListener('click', () => {
                const targetPrompt = document.querySelector(`[data-prompt-id='${promptId}']`);
                if (targetPrompt) {
                    targetPrompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetPrompt.classList.add('prompt-highlight');
                    setTimeout(() => {
                        targetPrompt.classList.remove('prompt-highlight');
                    }, HIGHLIGHT_DURATION_MS);
                }
            });
            sidebarList.appendChild(listItem);
        });
    }

    function observeConversation() {
        const conversationEl = document.querySelector(SELECTORS.conversationContainer);
        if (!conversationEl) {
            setTimeout(observeConversation, 500);
            return;
        }
        syncSidebar();
        const observer = new MutationObserver(() => {
            setTimeout(syncSidebar, 500);
        });
        observer.observe(conversationEl, { childList: true, subtree: true });
    }

    // --- Start the extension ---
    createSidebar();
    observeConversation();
}

// --- NEW: This block ensures the body exists before we run anything ---
if (document.body) {
    runExtension();
} else {
    // If the script runs before the body is ready, wait for the DOM to load.
    document.addEventListener('DOMContentLoaded', runExtension);
}