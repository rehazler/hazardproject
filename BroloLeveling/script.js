// ─── Constants ───────────────────────────────────────────────────────────────
const k = 10;

const FALLBACK_QUESTS = {
    beginner: [
        { id: "abs", name: "Abs" },
        { id: "weight-lifting", name: "Weight Lifting" },
        { id: "cardio", name: "Cardio" }
    ],
    intermediate: [
        { id: "abs", name: "Abs" },
        { id: "weight-lifting", name: "Weight Lifting" },
        { id: "cardio", name: "Cardio" },
        { id: "boxing", name: "Boxing" }
    ],
    rest: [
        { name: "Rest Day", tip: "Active recovery is key. Try light stretching or a short walk." },
        { name: "Cheat/Rest Day", tip: "Rest and recharge. Muscles grow during recovery!" }
    ],
    milestones: [
        { level: 10, title: "NOVICE WARRIOR", bonusXP: 50 },
        { level: 25, title: "BATTLE HARDENED", bonusXP: 150 },
        { level: 50, title: "ELITE ATHLETE", bonusXP: 500 },
        { level: 100, title: "LEGENDARY STATUS", bonusXP: 1000 }
    ]
};

// ─── State ────────────────────────────────────────────────────────────────────
let experiencePoints = parseInt(localStorage.getItem('experiencePoints')) || 0;
let level = parseInt(localStorage.getItem('level')) || 1;
let previousWeight = parseFloat(localStorage.getItem('previousWeight')) || 0;
let goalWeight = parseFloat(localStorage.getItem('goalWeight')) || 0;
let calorieGoal = parseInt(localStorage.getItem('calorieGoal')) || 0;
let isMinCalorie = localStorage.getItem('isMinCalorie') === 'true';
let stepGoal = parseInt(localStorage.getItem('stepGoal')) || 0;
let currentStreak = parseInt(localStorage.getItem('currentStreak')) || 0;
let bestStreak = parseInt(localStorage.getItem('bestStreak')) || 0;
let totalXPEarned = parseInt(localStorage.getItem('totalXPEarned')) || 0;
let totalDaysActive = parseInt(localStorage.getItem('totalDaysActive')) || 0;
let questData = null;
let multipleSubmissionsAllowed = false;
let lastSubmissionDay = localStorage.getItem('lastSubmissionDay') || null;
let currentDay = parseInt(localStorage.getItem('currentDay')) || 1;
let lastQuest = JSON.parse(localStorage.getItem('lastQuest')) || { lastDay: [] };

function getLevelScale(lvl) {
    if (lvl <= 5) return 1.06;
    if (lvl <= 10) return 1.08;
    if (lvl <= 15) return 1.10;
    if (lvl <= 20) return 1.12;
    return 1.15;
}

let levelScale = getLevelScale(level);

// ─── Initialization ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('quests.json');
        if (!res.ok) throw new Error('fetch failed');
        questData = await res.json();
    } catch (e) {
        questData = FALLBACK_QUESTS;
    }
    initializeApp();
});

function initializeApp() {
    let nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
    updateLevelDisplay(nextLevelXP);

    const today = new Date().toDateString();
    const lastGeneratedDay = localStorage.getItem('lastGeneratedDay') || '';

    if (today !== lastGeneratedDay) {
        dailyQuestGenerator(level, currentDay);
        localStorage.setItem('lastGeneratedDay', today);
        currentDay++;
        localStorage.setItem('currentDay', currentDay);
    } else {
        syncStepQuestToGoal();
        renderQuestDisplay(lastQuest.lastDay);
    }

    // Lock form if already submitted today
    if (lastSubmissionDay === today) {
        lockForm();
    }

    multipleSubmissionsAllowed = document.getElementById('allow-multiple-submissions').checked;
    document.getElementById('allow-multiple-submissions').addEventListener('change', (e) => {
        multipleSubmissionsAllowed = e.target.checked;
        if (multipleSubmissionsAllowed) {
            unlockForm();
        } else {
            const t = new Date().toDateString();
            if (lastSubmissionDay === t) lockForm();
        }
    });
}

// ─── Quest Generation ─────────────────────────────────────────────────────────
function dailyQuestGenerator(lvl, day) {
    const pool = lvl < 10 ? questData.beginner : questData.intermediate;
    let daily = [];

    if (day % 7 === 0) {
        const restEntry = questData.rest[Math.floor(day / 7) % questData.rest.length];
        daily = [restEntry.name];
        localStorage.setItem('lastRestDayDate', new Date().toDateString());
    } else {
        daily.push("Calorie Count");

        let available = pool.map(q => q.name).filter(n => n !== 'Cardio 2x');

        let numberOfQuests = lvl < 5 ? (Math.random() > 0.5 ? 1 : 0)
            : lvl <= 10 ? Math.floor(Math.random() * 2) + 1
            : 2;

        for (let i = 0; i < numberOfQuests && available.length > 0; i++) {
            const idx = Math.floor(Math.random() * available.length);
            daily.push(available.splice(idx, 1)[0]);
        }

        if ((day % 10) === 0) {
            daily.push("Weigh In");
        }

        if (stepGoal > 0) {
            daily.push("Steps Today");
        }
    }

    lastQuest.lastDay = daily.slice();
    localStorage.setItem('lastQuest', JSON.stringify(lastQuest));

    renderQuestDisplay(daily);
}

function renderQuestDisplay(daily) {
    const isRest = daily.length === 1 && daily[0].includes('Day');

    if (isRest) {
        const restEntry = questData.rest.find(r => r.name === daily[0]) || { name: daily[0], tip: '' };
        document.getElementById('daily').innerHTML =
            `<div class="quest-item" data-quest="${daily[0]}">${daily[0]}</div>` +
            (restEntry.tip ? `<div class="rest-tip">${restEntry.tip}</div>` : '') +
            `<div class="quest-item quest-incomplete" data-quest="Self-Care">[ Incomplete ] Self-Care</div>`;
        document.getElementById('daily-quest-items').innerHTML = `
            <div class="input-group">
                <label>Self-Care Completed: <input type="checkbox" id="self-care-completed" onchange="updateQuestStatus()"></label>
            </div>`;
        document.getElementById('workout-blocks-group').style.display = 'none';
    } else {
        document.getElementById('daily').innerHTML = daily.map(item =>
            `<div class="quest-item quest-incomplete" data-quest="${item}">[ Incomplete ] ${item}</div>`
        ).join('');

        const checkboxItems = daily.filter(item =>
            item !== 'Calorie Count' && item !== 'Weigh In' && item !== 'Steps Today'
        );

        document.getElementById('daily-quest-items').innerHTML = checkboxItems.map(item => {
            const safeId = item.replace(/\s+/g, '-').toLowerCase();
            return `<div class="input-group" id="${safeId}">
                <label>${item} Completed: <input type="checkbox" id="${safeId}-completed" onchange="updateQuestStatus()"></label>
            </div>`;
        }).join('');
    }

    document.getElementById('workout-blocks-group').style.display = isRest ? 'none' : 'block';
    document.getElementById('calorie-count-group').style.display =
        daily.includes("Calorie Count") ? 'block' : 'none';
    document.getElementById('weigh-in-group').style.display =
        daily.includes("Weigh In") ? 'block' : 'none';
    document.getElementById('step-count-group').style.display =
        daily.includes("Steps Today") ? 'block' : 'none';
}

// ─── Quest Status ─────────────────────────────────────────────────────────────
function updateQuestStatus() {
    const questItems = document.querySelectorAll('.quest-item');
    let completableCount = 0;
    let completedCount = 0;

    questItems.forEach(item => {
        const questName = item.getAttribute('data-quest');
        if (questName.includes('Day')) return;

        completableCount++;
        let completed = false;

        if (questName === 'Calorie Count') {
            const cal = parseInt(document.getElementById('calories').value) || 0;
            if (cal > 0 && calorieGoal > 0) {
                completed = isMinCalorie ? cal >= calorieGoal : cal <= calorieGoal;
            } else {
                completed = cal > 0;
            }
        } else if (questName === 'Steps Today') {
            const steps = parseInt(document.getElementById('step-count').value) || 0;
            completed = stepGoal > 0 && steps >= stepGoal;
        } else if (questName === 'Weigh In') {
            completed = !!document.getElementById('weight').value;
        } else {
            const safeId = questName.replace(/\s+/g, '-').toLowerCase();
            const checkbox = document.getElementById(`${safeId}-completed`);
            completed = checkbox ? checkbox.checked : false;
        }

        if (completed) {
            completedCount++;
            item.classList.remove('quest-incomplete');
            item.classList.add('quest-completed');
            item.innerHTML = `[ Completed ] ${questName}`;
        } else {
            item.classList.remove('quest-completed');
            item.classList.add('quest-incomplete');
            item.innerHTML = `[ Incomplete ] ${questName}`;
        }
    });

    const questContainer = document.querySelector('.quest-container div');
    if (completableCount > 0 && completedCount === completableCount) {
        questContainer.classList.add('all-quests-complete');
    } else {
        questContainer.classList.remove('all-quests-complete');
    }
}

// ─── Calculate Experience ─────────────────────────────────────────────────────
function calculateExperience() {
    const today = new Date().toDateString();

    if (!multipleSubmissionsAllowed && lastSubmissionDay === today) {
        return;
    }

    const calorieCount = parseInt(document.getElementById('calories').value) || 0;
    const weight = parseFloat(document.getElementById('weight').value) || 0;
    const workoutBlocks = parseInt(document.getElementById('workout-blocks').value) || 0;
    const stepsToday = parseInt(document.getElementById('step-count').value) || 0;

    let xp = 0;
    let extraBlocksXP = 0;
    const daily = lastQuest.lastDay;
    const isRestDay = daily.length === 1 && daily[0].includes('Day');

    // Determine calorie completion
    const calorieCompleted = calorieCount > 0 && (
        calorieGoal > 0 ? (isMinCalorie ? calorieCount >= calorieGoal : calorieCount <= calorieGoal) : true
    );

    // Determine steps completion
    const stepsCompleted = stepGoal > 0 && stepsToday >= stepGoal;

    if (isRestDay) {
        const selfCareCb = document.getElementById('self-care-completed');
        if (selfCareCb && selfCareCb.checked) xp += 5;
    } else {
        // Quest item XP
        daily.forEach(item => {
            if (item === 'Calorie Count') {
                if (calorieCompleted) xp += 5;
            } else if (item === 'Steps Today') {
                if (stepsCompleted) xp += 5;
            } else if (item === 'Weigh In') {
                // handled separately below
            } else if (!item.includes('Day')) {
                const safeId = item.replace(/\s+/g, '-').toLowerCase();
                const checkbox = document.getElementById(`${safeId}-completed`);
                if (checkbox && checkbox.checked) xp += 5;
            }
        });

        // Weigh In XP
        if (weight) xp += 5;

        // Workout blocks XP
        if (workoutBlocks > 0) {
            xp += 5;
            if (workoutBlocks > 1) extraBlocksXP = (workoutBlocks - 1) * 5;
        }
    }

    const totalEarned = xp + extraBlocksXP;
    experiencePoints += totalEarned;
    totalXPEarned += totalEarned;
    totalDaysActive++;

    // Level up loop
    let nextLevelXP = k * Math.floor(Math.pow(level, getLevelScale(level)));
    let didLevelUp = false;
    while (experiencePoints >= nextLevelXP) {
        level++;
        experiencePoints -= nextLevelXP;
        levelScale = getLevelScale(level);
        nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
        didLevelUp = true;
    }

    // Milestone check
    let milestoneTriggered = null;
    if (didLevelUp && questData) {
        const completedMilestones = JSON.parse(localStorage.getItem('completedMilestones') || '[]');
        const milestone = questData.milestones.find(m => m.level === level && !completedMilestones.includes(m.level));
        if (milestone) {
            experiencePoints += milestone.bonusXP;
            totalXPEarned += milestone.bonusXP;
            completedMilestones.push(milestone.level);
            localStorage.setItem('completedMilestones', JSON.stringify(completedMilestones));
            milestoneTriggered = milestone;
            // Re-check level after milestone XP
            nextLevelXP = k * Math.floor(Math.pow(level, getLevelScale(level)));
            while (experiencePoints >= nextLevelXP) {
                level++;
                experiencePoints -= nextLevelXP;
                levelScale = getLevelScale(level);
                nextLevelXP = k * Math.floor(Math.pow(level, getLevelScale(level)));
            }
        }
    }

    // Update streak
    updateStreak(today);

    // Weight feedback
    let weightFeedback = '';
    if (weight && previousWeight) {
        const diff = weight - previousWeight;
        if (goalWeight) {
            const toGoal = weight - goalWeight;
            if (diff < 0) {
                weightFeedback = `Down ${Math.abs(diff).toFixed(1)} lbs. ${toGoal > 0 ? `${toGoal.toFixed(1)} lbs to goal.` : 'Goal reached!'}`;
            } else if (diff > 0) {
                weightFeedback = `Up ${diff.toFixed(1)} lbs. ${toGoal > 0 ? `${toGoal.toFixed(1)} lbs to goal.` : 'Goal reached!'}`;
            } else {
                weightFeedback = `Same weight. ${toGoal > 0 ? `${toGoal.toFixed(1)} lbs to goal.` : 'Goal reached!'}`;
            }
        } else {
            weightFeedback = diff < 0 ? `Down ${Math.abs(diff).toFixed(1)} lbs from last weigh-in.`
                : diff > 0 ? `Up ${diff.toFixed(1)} lbs from last weigh-in.`
                : 'Same weight as last weigh-in.';
        }
    }

    // Save state
    localStorage.setItem('experiencePoints', experiencePoints);
    localStorage.setItem('level', level);
    localStorage.setItem('levelScale', levelScale);
    localStorage.setItem('totalXPEarned', totalXPEarned);
    localStorage.setItem('totalDaysActive', totalDaysActive);
    if (weight) {
        previousWeight = weight;
        localStorage.setItem('previousWeight', previousWeight);
    }
    lastSubmissionDay = today;
    localStorage.setItem('lastSubmissionDay', lastSubmissionDay);

    // Track quest completions
    trackQuestCompletions(daily, stepsToday, calorieCompleted, stepsCompleted, weight);

    // Add to history
    addToHistory(today, totalEarned, daily, level);

    updateLevelDisplay(nextLevelXP);

    // Build results HTML
    let resultHTML = `<h2 style="margin-top:15px">Earned Experience</h2>`;

    if (isRestDay) {
        const selfCareCb = document.getElementById('self-care-completed');
        resultHTML += `<p>Self-Care: ${selfCareCb && selfCareCb.checked ? '+5' : '+0'}</p>`;
    } else {
        daily.forEach(item => {
            if (item === 'Calorie Count') {
                resultHTML += `<p>Calorie Count: ${calorieCompleted ? '+5' : '+0'}</p>`;
            } else if (item === 'Steps Today') {
                resultHTML += `<p>Steps Today: ${stepsCompleted ? '+5' : '+0'}</p>`;
            } else if (item === 'Weigh In') {
                resultHTML += `<p>Weigh In: ${weight ? '+5' : '+0'}</p>`;
            } else if (!item.includes('Day')) {
                resultHTML += `<p>${item} (Daily Quest): +5</p>`;
            }
        });
        if (workoutBlocks > 0) {
            resultHTML += `<p>Workout Blocks: +${5 + extraBlocksXP}</p>`;
        }
    }

    if (weightFeedback) {
        resultHTML += `<p class="weight-feedback">${weightFeedback}</p>`;
    }

    resultHTML += `<h3>XP Earned Today: +${totalEarned}</h3>`;
    resultHTML += `<p>Streak: ${currentStreak} day${currentStreak !== 1 ? 's' : ''} 🔥</p>`;

    if (milestoneTriggered) {
        resultHTML += `
            <div class="milestone-banner">
                <h2>MILESTONE REACHED!</h2>
                <h3>${milestoneTriggered.title}</h3>
                <p>Bonus: +${milestoneTriggered.bonusXP} XP</p>
            </div>`;
    }

    document.getElementById('results').innerHTML = resultHTML;

    // Animations
    showXPFloat(totalEarned);
    if (didLevelUp) triggerLevelUpAnimation();

    lockForm();
}

// ─── Streak ───────────────────────────────────────────────────────────────────
function updateStreak(today) {
    const lastDay = localStorage.getItem('lastSubmissionDay');
    if (!lastDay) {
        currentStreak = 1;
    } else {
        const prev = new Date(lastDay);
        const curr = new Date(today);
        const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
            currentStreak++;
        } else if (diffDays === 2) {
            // Allow gap if the skipped day was a rest day
            const lastRestDate = localStorage.getItem('lastRestDayDate');
            const skipped = new Date(curr);
            skipped.setDate(skipped.getDate() - 1);
            if (lastRestDate === skipped.toDateString()) {
                currentStreak++;
            } else {
                currentStreak = 1;
            }
        } else if (diffDays > 2) {
            currentStreak = 1;
        }
        // diffDays === 0: same day (testing), no change
    }
    if (currentStreak > bestStreak) bestStreak = currentStreak;
    localStorage.setItem('currentStreak', currentStreak);
    localStorage.setItem('bestStreak', bestStreak);
}

// ─── History ──────────────────────────────────────────────────────────────────
function addToHistory(date, xpEarned, quests, lvl) {
    const history = JSON.parse(localStorage.getItem('history') || '[]');
    history.unshift({ date, xpEarned, quests: quests.slice(), level: lvl });
    if (history.length > 30) history.pop();
    localStorage.setItem('history', JSON.stringify(history));
}

function trackQuestCompletions(daily, stepsToday, calorieCompleted, stepsCompleted, weight) {
    const counts = JSON.parse(localStorage.getItem('questCompletionCounts') || '{}');
    daily.forEach(item => {
        if (item.includes('Day')) return;
        let completed = false;
        if (item === 'Calorie Count') completed = calorieCompleted;
        else if (item === 'Steps Today') completed = stepsCompleted;
        else if (item === 'Weigh In') completed = !!weight;
        else {
            const safeId = item.replace(/\s+/g, '-').toLowerCase();
            const cb = document.getElementById(`${safeId}-completed`);
            completed = cb ? cb.checked : false;
        }
        if (completed) counts[item] = (counts[item] || 0) + 1;
    });
    localStorage.setItem('questCompletionCounts', JSON.stringify(counts));
}

// ─── Form Lock ────────────────────────────────────────────────────────────────
function lockForm() {
    document.getElementById('submitted-banner').style.display = 'block';
    const form = document.getElementById('fitness-form');
    form.querySelectorAll('input').forEach(el => el.disabled = true);
    form.querySelectorAll('button.submit').forEach(el => el.disabled = true);
}

function unlockForm() {
    document.getElementById('submitted-banner').style.display = 'none';
    const form = document.getElementById('fitness-form');
    form.querySelectorAll('input').forEach(el => el.disabled = false);
    form.querySelectorAll('button.submit').forEach(el => el.disabled = false);
}

// ─── Level Display ────────────────────────────────────────────────────────────
function updateLevelDisplay(nextLevelXP) {
    const progressPercent = Math.min((experiencePoints / nextLevelXP) * 100, 100);
    document.getElementById('level').innerHTML = `
        <div class="level-text">
            <h2>Current Level</h2>
            <p class="current-level">Level: ${level}</p>
        </div>
        <div class="progress-bar">
            <div class="progress-text">${experiencePoints} / ${nextLevelXP} XP</div>
            <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>
    `;
}

// ─── Animations ───────────────────────────────────────────────────────────────
function showXPFloat(xp) {
    const btn = document.querySelector('#fitness-form button.submit');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = `+${xp} XP`;
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top + window.scrollY - 10}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
}

function triggerLevelUpAnimation() {
    const el = document.getElementById('level');
    el.classList.remove('level-up-animation');
    void el.offsetWidth; // force reflow
    el.classList.add('level-up-animation');
    el.addEventListener('animationend', () => el.classList.remove('level-up-animation'), { once: true });
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats() {
    const history = JSON.parse(localStorage.getItem('history') || '[]');
    const counts = JSON.parse(localStorage.getItem('questCompletionCounts') || '{}');

    let mostCompleted = '';
    let maxCount = 0;
    Object.entries(counts).forEach(([name, cnt]) => {
        if (cnt > maxCount) { maxCount = cnt; mostCompleted = name; }
    });

    const recent = history.slice(0, 7);

    const historyHTML = recent.length === 0
        ? '<p style="opacity:0.5;text-align:center;">No history yet.</p>'
        : `<div class="history-list">${recent.map(entry => `
            <div class="history-entry">
                <span>${entry.date}</span>
                <span class="history-xp">+${entry.xpEarned} XP</span>
                <span>Lvl ${entry.level}</span>
                <span class="history-quests">${entry.quests.join(', ')}</span>
            </div>`).join('')}</div>`;

    document.getElementById('stats-content').innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${currentStreak}</div>
                <div class="stat-label">CURRENT STREAK</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${bestStreak}</div>
                <div class="stat-label">BEST STREAK</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalDaysActive}</div>
                <div class="stat-label">DAYS ACTIVE</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalXPEarned}</div>
                <div class="stat-label">TOTAL XP EARNED</div>
            </div>
        </div>
        ${mostCompleted ? `<div class="most-completed">Most completed: <strong>${mostCompleted}</strong> (${maxCount}×)</div>` : ''}
        <h3>Recent Activity</h3>
        ${historyHTML}
    `;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showForm() {
    document.getElementById('fitness-form').style.display = 'block';
    document.getElementById('stats-section').style.display = 'none';
    document.getElementById('profile-section').style.display = 'none';
}

function showStats() {
    document.getElementById('fitness-form').style.display = 'none';
    document.getElementById('stats-section').style.display = 'block';
    document.getElementById('profile-section').style.display = 'none';
    renderStats();
}

function showProfile() {
    document.getElementById('fitness-form').style.display = 'none';
    document.getElementById('stats-section').style.display = 'none';
    document.getElementById('profile-section').style.display = 'block';

    document.getElementById('previous-weight').value = previousWeight || '';
    document.getElementById('goal-weight').value = goalWeight || '';
    document.getElementById('calorie-goal').value = calorieGoal || '';
    document.getElementById('is-min-calorie').checked = isMinCalorie;
    document.getElementById('step-goal').value = stepGoal || '';
}

// ─── Profile ──────────────────────────────────────────────────────────────────
function syncStepQuestToGoal() {
    const isRestDay = lastQuest.lastDay.length === 1 && lastQuest.lastDay[0].includes('Day');
    if (isRestDay) return;
    const hasSteps = lastQuest.lastDay.includes('Steps Today');
    if (stepGoal > 0 && !hasSteps) {
        lastQuest.lastDay.push('Steps Today');
        localStorage.setItem('lastQuest', JSON.stringify(lastQuest));
    } else if (stepGoal === 0 && hasSteps) {
        lastQuest.lastDay = lastQuest.lastDay.filter(q => q !== 'Steps Today');
        localStorage.setItem('lastQuest', JSON.stringify(lastQuest));
    }
}

function saveProfile() {
    previousWeight = parseFloat(document.getElementById('previous-weight').value) || 0;
    goalWeight = parseFloat(document.getElementById('goal-weight').value) || 0;
    calorieGoal = parseInt(document.getElementById('calorie-goal').value) || 0;
    isMinCalorie = document.getElementById('is-min-calorie').checked;
    stepGoal = parseInt(document.getElementById('step-goal').value) || 0;

    localStorage.setItem('previousWeight', previousWeight);
    localStorage.setItem('goalWeight', goalWeight);
    localStorage.setItem('calorieGoal', calorieGoal);
    localStorage.setItem('isMinCalorie', isMinCalorie);
    localStorage.setItem('stepGoal', stepGoal);

    syncStepQuestToGoal();
    renderQuestDisplay(lastQuest.lastDay);

    const msg = document.getElementById('profile-save-msg');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2000);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
}

function toggleLightMode() {
    document.body.classList.toggle('light-mode');
}

function toggleTestingMode() {
    const testingOptions = document.getElementById('testing-options');
    testingOptions.style.display = testingOptions.style.display === 'none' ? 'block' : 'none';
}

function setExperience() {
    let newExperience = parseInt(document.getElementById('current-experience').value);
    if (isNaN(newExperience)) { alert('Please enter a valid number'); return; }

    experiencePoints = newExperience;
    level = 1;
    levelScale = getLevelScale(level);
    let nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
    while (experiencePoints >= nextLevelXP) {
        level++;
        levelScale = getLevelScale(level);
        experiencePoints -= nextLevelXP;
        nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
    }
    localStorage.setItem('experiencePoints', experiencePoints);
    localStorage.setItem('level', level);
    updateLevelDisplay(nextLevelXP);
}

function generateNewDailyQuest() {
    dailyQuestGenerator(level, currentDay);
    currentDay++;
    localStorage.setItem('currentDay', currentDay);
    unlockForm();
}
