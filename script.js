const livesContainer = document.getElementById('lives-container');
const settingsBtn = document.getElementById('settings-btn');
const substringDisplay = document.getElementById('substring-display');
const timerBarInner = document.getElementById('timer-bar-inner');
const wordForm = document.getElementById('word-form');
const wordInput = document.getElementById('word-input');
const wordPreviewOverlay = document.getElementById('word-preview-overlay');
const alphabetContainer = document.getElementById('alphabet-container');
const controlPanel = document.getElementById('control-panel');
const startGameBtn = document.getElementById('start-game-btn');
const difficultyButtons = Array.from(document.querySelectorAll('[data-difficulty]'));

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
const ALPHABET_BONUS = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');

const DIFFICULTIES = {
    easy: { name: 'Easy', minWords: 500, time: 10 },
    medium: { name: 'Medium', minWords: 100, time: 8 },
    hard: { name: 'Hard', minWords: 20, time: 6 },
    expert: { name: 'Expert', minWords: 1, time: 5 }
};

const STARTING_LIVES = 3;
const MAX_LIVES = 5;

let pendingDifficultyKey = 'easy';
let currentDifficultyKey = 'easy';
let currentDifficulty = DIFFICULTIES[currentDifficultyKey];

let DICTIONARY = new Set();
let SUBSTRING_MAP = new Map();
let usedWordsInGame = new Set();
let usedCharsInGame = new Set();

let lives = STARTING_LIVES;
let timerInterval = null;
let turnTime = currentDifficulty.time;
let currentTime = turnTime;
let currentSubstring = '';
let currentWordList = new Set();
let isGameOver = true;
let isDictionaryLoaded = false;

init();

function init() {
    renderAlphabet();
    attachEventListeners();
    resetWordPreview();
    updateDifficultyButtons();
    updateLivesUI();
    updateAlphabetUI();
    updateStartButtonState();
    loadDictionary();
}

function attachEventListeners() {
    wordForm.addEventListener('submit', handleWordSubmit);
    wordInput.addEventListener('input', () => updateWordPreview(wordInput.value));
    settingsBtn.addEventListener('click', () => controlPanel.classList.toggle('collapsed'));
    startGameBtn.addEventListener('click', startGame);

    difficultyButtons.forEach((button) => {
        button.addEventListener('click', () => {
            pendingDifficultyKey = button.dataset.difficulty;
            updateDifficultyButtons();
        });
    });
}

function updateStartButtonState() {
    if (!isDictionaryLoaded) {
        startGameBtn.disabled = true;
        startGameBtn.textContent = 'Loading...';
    } else {
        startGameBtn.disabled = false;
        startGameBtn.textContent = 'Start Game';
    }
}

async function loadDictionary() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt');
        const text = await response.text();

        const words = text
            .split('\n')
            .map((word) => word.trim().toUpperCase())
            .filter((word) => word.length >= 2); //words only length 2+ as we can include "it" if our substring is "it"

        DICTIONARY = new Set(words);
        preprocessSubstrings();
        isDictionaryLoaded = true;
        updateStartButtonState();
    } catch (error) {
        console.error('Failed to load dictionary:', error);
        substringDisplay.textContent = 'ERR';
        startGameBtn.textContent = 'Dictionary Error';
    }
}

function preprocessSubstrings() {
    const tempMap = new Map();

    DICTIONARY.forEach((word) => {
        const length = word.length;
        if (length < 2) return;

        for (let i = 0; i <= length - 3; i += 1) {
            const substring = word.substring(i, i + 3);
            if (!tempMap.has(substring)) tempMap.set(substring, []);
            tempMap.get(substring).push(word);
        }

        for (let i = 0; i <= length - 2; i += 1) {
            const substring = word.substring(i, i + 2);
            if (!tempMap.has(substring)) tempMap.set(substring, []);
            tempMap.get(substring).push(word);
        }
    });
    //For every single word, we have just grabbed all 3 and 2 letter chunks
    //and stored those as a map like this, by substring:
    // SUBSTRING_MAP: Map {
    //     "CAT" → [ "CATALYST", "CATCH", "CATEGORY", ... ],
    //     "AL"  → [ "CATALYST", "ALPHA", "TALENT", ... ],
    //     ...
    // }

    SUBSTRING_MAP = tempMap;
}

function handleWordSubmit(event) {
    event.preventDefault();
    if (isGameOver) return;

    const submittedWord = wordInput.value.trim().toUpperCase();
    if (!submittedWord) return;

    validateWord(submittedWord);
    wordInput.value = '';
    resetWordPreview();
}

function validateWord(word) {
    const isValid = currentWordList.has(word);
    const isUsed = usedWordsInGame.has(word);

    if (isValid && !isUsed) {
        usedWordsInGame.add(word);
        word.split('').forEach((char) => usedCharsInGame.add(char));
        updateAlphabetUI();
        checkAlphabetBonus();
        startNewTurn();
    } else {
        wordInput.classList.add('shake');
        setTimeout(() => wordInput.classList.remove('shake'), 500);
    }
}

function startGame() {
    if (!isDictionaryLoaded) return;

    clearInterval(timerInterval);
    currentDifficultyKey = pendingDifficultyKey;
    currentDifficulty = DIFFICULTIES[currentDifficultyKey];
    turnTime = currentDifficulty.time;
    lives = STARTING_LIVES;
    currentTime = turnTime;
    isGameOver = false;

    usedWordsInGame.clear();
    usedCharsInGame.clear();
    wordInput.disabled = false;
    wordInput.value = '';
    resetWordPreview();
    updateLivesUI();
    updateAlphabetUI();
    substringDisplay.textContent = '...';
    startNewTurn();
}

function startNewTurn() {
    if (isGameOver) return;

    clearInterval(timerInterval);
    currentTime = turnTime;
    wordInput.value = '';
    resetWordPreview();
    wordInput.focus();

    generateSubstring();
    updateTimerUI();

    timerInterval = setInterval(() => {
        currentTime = Math.max(0, currentTime - 0.1);
        updateTimerUI();

        if (currentTime <= 0) {
            loseLife();
        }
    }, 100);
}

function generateSubstring() {
    const candidates = [];

    for (const [substring, words] of SUBSTRING_MAP.entries()) {
        if (words.length >= currentDifficulty.minWords) {
            candidates.push({ substring, words });
        }
    }

    if (!candidates.length) {
        substringDisplay.textContent = 'N/A';
        currentSubstring = '';
        currentWordList = new Set();
        return;
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    const selection = candidates[randomIndex];

    currentSubstring = selection.substring.toUpperCase();
    currentWordList = new Set(selection.words);
    substringDisplay.textContent = currentSubstring;
}

function updateTimerUI() {
    const percentage = turnTime === 0 ? 0 : (currentTime / turnTime) * 100;
    timerBarInner.style.width = `${Math.max(0, Math.min(100, percentage))}%`;

    if (percentage <= 25) {
        timerBarInner.style.background = '#f56565';
    } else {
        timerBarInner.style.background = '#68d391';
    }
}

function loseLife() {
    clearInterval(timerInterval);
    lives -= 1;
    updateLivesUI();

    if (lives <= 0) {
        gameOver();
    } else {
        startNewTurn();
    }
}

function gameOver() {
    isGameOver = true;
    wordInput.disabled = true;
    substringDisplay.textContent = 'BOOM!';
    timerBarInner.style.width = '0%';
}

function updateLivesUI() {
    livesContainer.innerHTML = '';

    for (let i = 0; i < MAX_LIVES; i += 1) {
        const isActive = i < lives;
        const heart = `
            <svg xmlns="http://www.w3.org/2000/svg" class="life-icon ${isActive ? 'life-icon--active' : 'life-icon--inactive'}" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
            </svg>
        `;
        livesContainer.insertAdjacentHTML('beforeend', heart);
    }
}

function renderAlphabet() {
    alphabetContainer.innerHTML = ALPHABET.map(
        (char) => `<div id="char-${char}" class="alphabet-char">${char}</div>`
    ).join('');
}

function updateAlphabetUI() {
    ALPHABET.forEach((char) => {
        const element = document.getElementById(`char-${char}`);
        if (!element) return;

        if (usedCharsInGame.has(char)) {
            element.classList.add('used');
        } else {
            element.classList.remove('used');
        }
    });
}

function checkAlphabetBonus() {
    const bonusAchieved = ALPHABET_BONUS.every((char) => usedCharsInGame.has(char));

    if (!bonusAchieved) return;

    if (lives < MAX_LIVES) {
        lives += 1;
        updateLivesUI();
    }

    usedCharsInGame.clear();
    ALPHABET_BONUS.forEach((char) => {
        const element = document.getElementById(`char-${char}`);
        if (element) element.classList.remove('used');
    });
}

function updateDifficultyButtons() {
    difficultyButtons.forEach((button) => {
        const isPending = button.dataset.difficulty === pendingDifficultyKey;
        button.classList.toggle('active', isPending);
    });
}

function resetWordPreview() {
    wordPreviewOverlay.textContent = '';
}

function updateWordPreview(rawValue) {
    if (!rawValue) {
        resetWordPreview();
        return;
    }

    const uppercaseValue = rawValue.toUpperCase();
    const target = currentSubstring.toUpperCase();

    if (!target || !target.length) {
        wordPreviewOverlay.textContent = rawValue;
        return;
    }

    const matchIndex = uppercaseValue.indexOf(target);

    if (matchIndex === -1) {
        wordPreviewOverlay.textContent = rawValue;
        return;
    }

    const before = rawValue.slice(0, matchIndex);
    const match = rawValue.slice(matchIndex, matchIndex + currentSubstring.length);
    const after = rawValue.slice(matchIndex + currentSubstring.length);

    wordPreviewOverlay.innerHTML = `${escapeHtml(before)}<span class="highlighted-substring">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function escapeHtml(value) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    return value.replace(/[&<>"']/g, (char) => map[char]);
}
