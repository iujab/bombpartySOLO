// ===== CONSTANTS =====
const DICTIONARY_URL = 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const DIFFICULTIES = {
    easy: { name: 'Easy', minWords: 500, time: 10 },
    medium: { name: 'Medium', minWords: 100, time: 8 },
    hard: { name: 'Hard', minWords: 20, time: 6 },
    expert: { name: 'Expert', minWords: 1, time: 5 }
};

const STARTING_LIVES = 3;
const MAX_LIVES = 5;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_PARTICLES = 200;
const MAX_WORD_HISTORY = 50;

// Letter rarity values — rarer letters = higher value
const LETTER_VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4,
    I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3,
    Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
};

// ===== STORAGE ABSTRACTION =====
const Storage = {
    get(key, fallback) {
        try {
            const val = localStorage.getItem(key);
            return val !== null ? JSON.parse(val) : fallback;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch { /* quota exceeded or private browsing */ }
    }
};

// ===== DOM ELEMENTS =====
const livesContainer = document.getElementById('lives-container');
const substringDisplay = document.getElementById('substring-display');
const timerBarInner = document.getElementById('timer-bar-inner');
const wordForm = document.getElementById('word-form');
const wordInput = document.getElementById('word-input');
const wordPreviewOverlay = document.getElementById('word-preview-overlay');
const alphabetContainer = document.getElementById('alphabet-container');
const controlPanel = document.getElementById('control-panel');
const bombContainer = document.getElementById('bomb-container');
const startGameBtn = document.getElementById('start-game-btn');
const difficultyButtons = Array.from(document.querySelectorAll('[data-difficulty]'));
const soundBtn = document.getElementById('sound-btn');
const particleCanvas = document.getElementById('particle-canvas');
const toastContainer = document.getElementById('toast-container');
const wordHistory = document.getElementById('word-history');

// Missed words display
const missedWordsContainer = document.getElementById('missed-words');

// Game over section (inline in sidebar)
const gameOverSection = document.getElementById('game-over-section');
const finalWords = document.getElementById('final-words');
const finalWpm = document.getElementById('final-wpm');
const finalBestValue = document.getElementById('final-best-value');
const newHighScoreBadge = document.getElementById('new-high-score-badge');
const playAgainBtn = document.getElementById('play-again-btn');

// ===== PARTICLE SYSTEM STATE =====
let particles = [];
let particleCtx = null;
let particleAnimId = null;

// ===== AUDIO STATE =====
let audioCtx = null;
let soundEnabled = Storage.get('soundEnabled', true);
let soundVolume = Storage.get('soundVolume', 0.5);

// ===== GAME STATE =====
let DICTIONARY = new Set();
let SUBSTRING_MAP = new Map();
let usedWordsInGame = new Set();
let usedCharsInGame = new Set();

let pendingDifficultyKey = Storage.get('difficulty', 'easy');
let currentDifficultyKey = pendingDifficultyKey;
let currentDifficulty = DIFFICULTIES[currentDifficultyKey];

let lives = STARTING_LIVES;
let timerInterval = null;
let turnTime = currentDifficulty.time;
let currentTime = turnTime;
let turnStartTime = 0;
let currentSubstring = '';
let currentWordList = new Set();
let isGameOver = true;
let isDictionaryLoaded = false;

let combo = 0;
let maxCombo = 0;
let wordsThisGame = 0;
let alphabetBonusCount = 0;
let lastTickTime = 0;

// Per-word stats tracking
let totalCharsTyped = 0;
let totalTypingTime = 0; // seconds spent typing words (successful only)
let bestWordValue = 0;
let bestSingleWpm = 0;
let typingStartTime = 0; // tracks when user first types in a turn

// ===== INIT =====
init();

function init() {
    initParticleCanvas();
    renderAlphabet();
    attachEventListeners();
    resetWordPreview();
    updateDifficultyButtons();
    updateLivesUI();
    updateAlphabetUI();
    updateStartButtonState();
    updateSoundButtonUI();
    updateRunStats();
    renderStatsPanel();
    loadDictionary();
}

// ===== PARTICLE CANVAS =====
function initParticleCanvas() {
    particleCtx = particleCanvas.getContext('2d');
    resizeParticleCanvas();
    window.addEventListener('resize', resizeParticleCanvas);
}

function resizeParticleCanvas() {
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function spawnParticles(x, y, color, count) {
    if (prefersReducedMotion()) return;
    const available = MAX_PARTICLES - particles.length;
    const toSpawn = Math.min(count, available);
    for (let i = 0; i < toSpawn; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10 - 3,
            life: 1,
            decay: 0.015 + Math.random() * 0.02,
            size: 2 + Math.random() * 4,
            color
        });
    }
    if (!particleAnimId) animateParticles();
}

function animateParticles() {
    particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.life -= p.decay;
        if (p.life <= 0) return false;
        particleCtx.globalAlpha = p.life;
        particleCtx.fillStyle = p.color;
        particleCtx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        return true;
    });
    particleCtx.globalAlpha = 1;
    if (particles.length > 0) {
        particleAnimId = requestAnimationFrame(animateParticles);
    } else {
        particleAnimId = null;
    }
}

// ===== AUDIO SYSTEM =====
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type, extraData) {
    if (!soundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const vol = soundVolume * 0.4;

    switch (type) {
        case 'correct': {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.2);
            break;
        }
        case 'wrong': {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(120, now);
            gain.gain.setValueAtTime(vol * 0.6, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
        }
        case 'explosion': {
            const bufferSize = Math.floor(audioCtx.sampleRate * 0.5);
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1000, now);
            filter.frequency.exponentialRampToValueAtTime(100, now + 0.4);
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            source.connect(filter);
            filter.connect(gain);
            gain.connect(audioCtx.destination);
            source.start(now);
            source.stop(now + 0.5);
            break;
        }
        case 'bonus': {
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.08);
                gain.gain.setValueAtTime(vol * 0.5, now + i * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now + i * 0.08);
                osc.stop(now + i * 0.08 + 0.2);
            });
            break;
        }
        case 'combo': {
            const comboNum = extraData || 1;
            const baseFreq = 400 + comboNum * 40;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseFreq, now);
            osc.frequency.setValueAtTime(baseFreq * 1.25, now + 0.06);
            gain.gain.setValueAtTime(vol * 0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
            break;
        }
        case 'tick': {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(vol * 0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
            break;
        }
    }
}

function updateSoundButtonUI() {
    if (!soundBtn) return;
    soundBtn.classList.toggle('sound-off', !soundEnabled);
    soundBtn.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Unmute sound');
}

// ===== TOAST SYSTEM =====
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast--leaving');
        toast.addEventListener('animationend', () => toast.remove());
        // Fallback removal if animation doesn't fire (e.g. prefers-reduced-motion)
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
    }, 2500);
}

// ===== SCORE POP =====
function showScorePop(text, x, y) {
    if (prefersReducedMotion()) return;
    const pop = document.createElement('div');
    pop.className = 'score-pop';
    pop.textContent = text;
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    document.body.appendChild(pop);
    pop.addEventListener('animationend', () => pop.remove());
}

// ===== WORD VALUE CALCULATION =====
// Value = sum of rarity scores for all unique letters in the word
function calculateWordValue(word) {
    const seen = new Set();
    let value = 0;
    for (const char of word) {
        if (!seen.has(char)) {
            seen.add(char);
            value += (LETTER_VALUES[char] || 0);
        }
    }
    return value;
}

// ===== WORD HISTORY =====
function addToWordHistory(word, timeTaken, wordValue, wordWpm) {
    const item = document.createElement('div');
    item.className = 'word-history-item';
    item.innerHTML = `
        <span class="word-history-word">${escapeHtml(word)}</span>
        <span class="word-history-time">${timeTaken.toFixed(1)}s</span>
        <span class="word-history-len">${word.length}</span>
        <span class="word-history-value">${wordValue}</span>
        <span class="word-history-wpm">${wordWpm}</span>
    `;
    wordHistory.prepend(item);

    while (wordHistory.children.length > MAX_WORD_HISTORY) {
        wordHistory.removeChild(wordHistory.lastChild);
    }

    updateWordHistoryFade();
}

function clearWordHistory() {
    wordHistory.innerHTML = '';
    updateWordHistoryFade();
}

function updateWordHistoryFade() {
    const wrapper = wordHistory.parentElement;
    if (!wrapper) return;
    const hasOverflow = wordHistory.scrollHeight > wrapper.clientHeight;
    const atBottom = wordHistory.scrollHeight - wordHistory.scrollTop - wordHistory.clientHeight < 4;
    wrapper.classList.toggle('has-overflow', hasOverflow && !atBottom);
}

// ===== RUN STATS (top bar) =====
function updateRunStats() {
    // Stats tracked internally for game-over display, no top-bar UI
}

// ===== MISSED WORDS SUGGESTIONS =====
function getMissedWordSuggestions(wordList, usedWords) {
    // Filter to unused valid words
    const available = [...wordList].filter(w => !usedWords.has(w));
    if (available.length === 0) return [];

    // Sort by length (shortest = easiest/best)
    available.sort((a, b) => a.length - b.length);

    // Pick the best (shortest) word
    const best = available[0];

    // Pick up to 4 random others (not the best)
    const rest = available.slice(1);
    const others = [];
    const picked = new Set();
    while (others.length < 4 && others.length < rest.length) {
        const idx = Math.floor(Math.random() * rest.length);
        if (!picked.has(idx)) {
            picked.add(idx);
            others.push(rest[idx]);
        }
    }

    return [best, ...others];
}

function showMissedWords(words) {
    if (!words.length) {
        hideMissedWords();
        return;
    }

    let html = '<div class="missed-words-title">You could have typed</div>';
    words.forEach((word, i) => {
        html += `<div class="missed-word-item">
            <span class="missed-word-rank">${i + 1}.</span>
            <span class="missed-word-text">${escapeHtml(word)}</span>
            <span class="missed-word-len">${word.length} letters</span>
        </div>`;
    });

    missedWordsContainer.innerHTML = html;
    missedWordsContainer.classList.add('visible');
}

function hideMissedWords() {
    missedWordsContainer.classList.remove('visible');
}

// ===== EVENT LISTENERS =====
function attachEventListeners() {
    wordForm.addEventListener('submit', handleWordSubmit);
    wordInput.addEventListener('input', () => {
        if (!typingStartTime && wordInput.value.length > 0) {
            typingStartTime = performance.now();
        }
        updateWordPreview(wordInput.value);
    });

    startGameBtn.addEventListener('click', () => {
        if (!isDictionaryLoaded) {
            startGameBtn.disabled = true;
            startGameBtn.textContent = 'LOADING...';
            loadDictionary(1);
        } else {
            startGame();
        }
    });

    playAgainBtn.addEventListener('click', () => {
        startGame();
    });

    soundBtn.addEventListener('click', () => {
        initAudio();
        soundEnabled = !soundEnabled;
        Storage.set('soundEnabled', soundEnabled);
        updateSoundButtonUI();
    });

    difficultyButtons.forEach((button) => {
        button.addEventListener('click', () => {
            pendingDifficultyKey = button.dataset.difficulty;
            Storage.set('difficulty', pendingDifficultyKey);
            updateDifficultyButtons();
        });
    });

    // Lazily init audio on first user gesture
    document.addEventListener('click', () => initAudio(), { once: true });
    document.addEventListener('keydown', () => initAudio(), { once: true });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Word history scroll fade
    wordHistory.addEventListener('scroll', updateWordHistoryFade);

    // Mobile soft keyboard handling
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportResize);
    }
}

function handleKeyboardShortcuts(e) {
    if ((e.key === 'm' || e.key === 'M') && document.activeElement !== wordInput) {
        initAudio();
        soundEnabled = !soundEnabled;
        Storage.set('soundEnabled', soundEnabled);
        updateSoundButtonUI();
    } else if (e.key === 'Enter' && isGameOver && document.activeElement !== wordInput) {
        e.preventDefault();
        startGame();
    }
}

function handleViewportResize() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const offset = window.innerHeight - viewport.height;
    document.documentElement.style.setProperty('--keyboard-offset', `${Math.max(0, offset)}px`);
}

// ===== DICTIONARY =====
async function loadDictionary(attempt = 1) {
    try {
        const response = await fetch(DICTIONARY_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();

        const words = text
            .split('\n')
            .map((word) => word.trim().toUpperCase())
            .filter((word) => word.length >= 2);

        DICTIONARY = new Set(words);
        preprocessSubstrings();
        isDictionaryLoaded = true;
        updateStartButtonState();
    } catch (error) {
        console.error(`Dictionary load attempt ${attempt} failed:`, error);
        if (attempt < MAX_RETRY_ATTEMPTS) {
            const delay = Math.pow(2, attempt) * 500;
            startGameBtn.textContent = `RETRY ${attempt}/${MAX_RETRY_ATTEMPTS}`;
            setTimeout(() => loadDictionary(attempt + 1), delay);
        } else {
            substringDisplay.textContent = 'ERR';
            startGameBtn.textContent = 'RETRY';
            startGameBtn.disabled = false;
        }
    }
}

function updateStartButtonState() {
    if (!isDictionaryLoaded) {
        startGameBtn.disabled = true;
        startGameBtn.textContent = 'LOADING...';
    } else {
        startGameBtn.disabled = false;
        startGameBtn.textContent = 'START GAME';
    }
}

function preprocessSubstrings() {
    const tempMap = new Map();

    DICTIONARY.forEach((word) => {
        const length = word.length;
        if (length < 2) return;

        for (let i = 0; i <= length - 3; i++) {
            const sub = word.substring(i, i + 3);
            if (!tempMap.has(sub)) tempMap.set(sub, []);
            tempMap.get(sub).push(word);
        }

        for (let i = 0; i <= length - 2; i++) {
            const sub = word.substring(i, i + 2);
            if (!tempMap.has(sub)) tempMap.set(sub, []);
            tempMap.get(sub).push(word);
        }
    });

    SUBSTRING_MAP = tempMap;
}

// ===== GAME LOGIC =====
function startGame() {
    if (!isDictionaryLoaded) return;
    initAudio();

    clearInterval(timerInterval);
    currentDifficultyKey = pendingDifficultyKey;
    currentDifficulty = DIFFICULTIES[currentDifficultyKey];
    turnTime = currentDifficulty.time;
    lives = STARTING_LIVES;
    currentTime = turnTime;
    isGameOver = false;
    combo = 0;
    maxCombo = 0;
    wordsThisGame = 0;
    alphabetBonusCount = 0;
    totalCharsTyped = 0;
    totalTypingTime = 0;
    bestWordValue = 0;
    bestSingleWpm = 0;

    usedWordsInGame.clear();
    usedCharsInGame.clear();
    wordInput.disabled = false;
    wordInput.value = '';
    resetWordPreview();
    updateLivesUI();
    updateAlphabetUI();
    updateRunStats();
    clearWordHistory();
    hideMissedWords();
    substringDisplay.textContent = '...';
    gameOverSection.classList.add('hidden');

    startNewTurn();
}

function startNewTurn() {
    if (isGameOver) return;

    clearInterval(timerInterval);
    currentTime = turnTime;
    turnStartTime = performance.now();
    typingStartTime = 0;
    wordInput.value = '';
    resetWordPreview();
    wordInput.focus();
    lastTickTime = -1;

    generateSubstring();
    updateTimerUI();
    updateBombPulse();

    timerInterval = setInterval(() => {
        const elapsed = (performance.now() - turnStartTime) / 1000;
        currentTime = Math.max(0, turnTime - elapsed);
        updateTimerUI();
        updateBombPulse();

        // Tick sound when timer < 25%, throttled to 1/sec
        const percentage = turnTime === 0 ? 0 : currentTime / turnTime;
        if (percentage < 0.25 && percentage > 0) {
            const nowSec = Math.floor(currentTime);
            if (nowSec !== lastTickTime) {
                lastTickTime = nowSec;
                playSound('tick');
            }
        }

        if (currentTime <= 0) {
            loseLife();
        }
    }, 50);
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
        const timeTaken = (performance.now() - (typingStartTime || turnStartTime)) / 1000;

        // Calculate word value BEFORE updating usedCharsInGame
        const wordValue = calculateWordValue(word);
        if (wordValue > bestWordValue) bestWordValue = wordValue;

        combo++;
        if (combo > maxCombo) maxCombo = combo;
        wordsThisGame++;
        totalCharsTyped += word.length;
        totalTypingTime += timeTaken;

        // Per-word WPM: (chars / 5) / (timeTaken / 60)
        const wordWpm = timeTaken > 0 ? Math.round((word.length / 5) / (timeTaken / 60)) : 0;
        if (wordWpm > bestSingleWpm) bestSingleWpm = wordWpm;

        usedWordsInGame.add(word);
        word.split('').forEach((char) => usedCharsInGame.add(char));

        updateAlphabetUI();
        updateRunStats();
        addToWordHistory(word, timeTaken, wordValue, wordWpm);

        // Particles from input area
        const inputRect = wordInput.getBoundingClientRect();
        spawnParticles(inputRect.left + inputRect.width / 2, inputRect.top, '#68d391', 15);

        // Pop showing value
        if (wordValue > 0) {
            showScorePop(`+${wordValue}`, inputRect.left + inputRect.width / 2, inputRect.top - 10);
        }

        // Sound
        if (combo >= 2) {
            playSound('combo', combo);
        } else {
            playSound('correct');
        }

        checkAlphabetBonus();
        startNewTurn();
    } else if (isUsed) {
        showToast('Already used!', 'error');
        wordInput.classList.add('shake');
        playSound('wrong');
        setTimeout(() => wordInput.classList.remove('shake'), 500);
    } else {
        showToast('Not in word list!', 'error');
        wordInput.classList.add('shake');
        playSound('wrong');
        setTimeout(() => wordInput.classList.remove('shake'), 500);
    }
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

    const hue = (percentage / 100) * 120;
    timerBarInner.style.background = `hsl(${hue}, 70%, 55%)`;
}

function updateBombPulse() {
    const percentage = turnTime === 0 ? 0 : currentTime / turnTime;

    bombContainer.classList.remove('bomb-pulse-slow', 'bomb-pulse-fast');
    if (prefersReducedMotion()) return;

    if (percentage <= 0.25) {
        bombContainer.classList.add('bomb-pulse-fast');
    } else if (percentage <= 0.5) {
        bombContainer.classList.add('bomb-pulse-slow');
    }
}

function loseLife() {
    clearInterval(timerInterval);
    lives--;
    combo = 0;
    updateLivesUI();

    playSound('wrong');

    if (!prefersReducedMotion()) {
        document.body.classList.add('screen-shake');
        setTimeout(() => document.body.classList.remove('screen-shake'), 400);
    }

    // Show what words the player could have typed (persists until next miss or game end)
    const suggestions = getMissedWordSuggestions(currentWordList, usedWordsInGame);
    showMissedWords(suggestions);

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

    bombContainer.classList.remove('bomb-pulse-slow', 'bomb-pulse-fast');

    playSound('explosion');

    // Red explosion particles from bomb
    const bombRect = bombContainer.getBoundingClientRect();
    spawnParticles(bombRect.left + bombRect.width / 2, bombRect.top + bombRect.height / 2, '#f56565', 50);

    // Calculate final avg WPM
    const avgWpm = totalTypingTime > 0 ? Math.round((totalCharsTyped / 5) / (totalTypingTime / 60)) : 0;

    // Update persistent stats (merge with defaults to handle missing fields)
    const stats = { ...getDefaultStats(), ...Storage.get('stats', {}) };
    stats.totalWordsFound += wordsThisGame;
    if (maxCombo > stats.longestStreak) stats.longestStreak = maxCombo;
    if (wordsThisGame > stats.longestGame) stats.longestGame = wordsThisGame;
    if (bestSingleWpm > stats.bestWpm) stats.bestWpm = bestSingleWpm;
    Storage.set('stats', stats);

    const isNewBest = wordsThisGame > 0 && wordsThisGame >= stats.longestGame;

    // Show inline game over in sidebar
    finalWords.textContent = wordsThisGame;
    finalWpm.textContent = avgWpm;
    finalBestValue.textContent = bestWordValue;
    if (isNewBest) {
        newHighScoreBadge.classList.remove('hidden');
        showToast('New personal best!', 'bonus');
    } else {
        newHighScoreBadge.classList.add('hidden');
    }

    gameOverSection.classList.remove('hidden');
    renderStatsPanel();
}

function getDefaultStats() {
    return {
        bestWpm: 0,
        longestStreak: 0,
        totalWordsFound: 0,
        longestGame: 0
    };
}

// ===== STATS PANEL =====
function renderStatsPanel() {
    const stats = { ...getDefaultStats(), ...Storage.get('stats', {}) };
    const ids = {
        'stat-best-wpm': stats.bestWpm,
        'stat-longest-streak': stats.longestStreak,
        'stat-total-words': stats.totalWordsFound,
        'stat-longest': stats.longestGame
    };

    for (const [id, value] of Object.entries(ids)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }
}

// ===== UI UPDATES =====
function updateLivesUI() {
    livesContainer.innerHTML = '';

    for (let i = 0; i < MAX_LIVES; i++) {
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
        element.classList.toggle('used', usedCharsInGame.has(char));
    });
}

function checkAlphabetBonus() {
    const bonusAchieved = ALPHABET.every((char) => usedCharsInGame.has(char));
    if (!bonusAchieved) return;

    alphabetBonusCount++;

    if (lives < MAX_LIVES) {
        lives++;
        updateLivesUI();
    }

    const alphaRect = alphabetContainer.getBoundingClientRect();
    spawnParticles(alphaRect.left + alphaRect.width / 2, alphaRect.top, '#f6ad55', 40);

    playSound('bonus');
    showToast('Alphabet Bonus! +1 Life', 'bonus');

    usedCharsInGame.clear();
    ALPHABET.forEach((char) => {
        const element = document.getElementById(`char-${char}`);
        if (element) element.classList.remove('used');
    });
}

function updateDifficultyButtons() {
    difficultyButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.difficulty === pendingDifficultyKey);
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
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return value.replace(/[&<>"']/g, (char) => map[char]);
}
