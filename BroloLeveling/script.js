let experiencePoints = parseInt(localStorage.getItem('experiencePoints')) || 0;
let level = parseInt(localStorage.getItem('level')) || 1;
let previousWeight = parseInt(localStorage.getItem('previousWeight')) || 0;
let goalWeight = parseInt(localStorage.getItem('goalWeight')) || 0;
let calorieGoal = parseInt(localStorage.getItem('calorieGoal')) || 0;
let isMinCalorie = localStorage.getItem('isMinCalorie') === 'true';
let stepGoal = parseInt(localStorage.getItem('stepGoal')) || 0;
let levelScale = 1.05;
const k = 10;  // Constant for experience scaling
let currentDay = parseInt(localStorage.getItem('currentDay')) || 1;
let lastQuest = JSON.parse(localStorage.getItem('lastQuest')) || {abs: false, cardio: false, lastDay: []};
let multipleSubmissionsAllowed = false;
let lastSubmissionDay = localStorage.getItem('lastSubmissionDay') || null;

function calculateExperience() {
    const today = new Date().toDateString();

    if (!multipleSubmissionsAllowed && lastSubmissionDay === today) {
        alert('You have already submitted your form for today.');
        return;
    }

    let calorieCount = document.getElementById('calories').value;
    let weight = document.getElementById('weight').value;
    let workoutBlocks = document.getElementById('workout-blocks').value;
    let milesRun = document.getElementById('mile-count').value;
    let xp = 0;
    let sideQuestXP = 0;

    lastQuest.lastDay.forEach(item => {
        if (item === 'Cardio' && milesRun >= 1) {
            xp += 5;
        } else if (item === 'Cardio 2x' && milesRun >= 2) {
            xp += 10;
        } else if (item === 'Calorie Count' && calorieCount > 0) {
            xp += 5;
        } else if (document.getElementById(`${item.toLowerCase()}-completed`) && document.getElementById(`${item.toLowerCase()}-completed`).checked) {
            xp += 5;
        }
    });

    if (weight) xp += 5;

    if (workoutBlocks) {
        xp += 5;  // For the first 30 minute block
        if (workoutBlocks > 1) {
            sideQuestXP += (workoutBlocks - 1) * 5;
        }
    }

    if (milesRun) {
        if (lastQuest.lastDay.includes('Cardio') && milesRun > 1) {
            sideQuestXP += (milesRun - 1) * 5;
        } else if (lastQuest.lastDay.includes('Cardio 2x') && milesRun > 2) {
            sideQuestXP += (milesRun - 2) * 5;
        } else if (!lastQuest.lastDay.includes('Cardio') && !lastQuest.lastDay.includes('Cardio 2x')) {
            sideQuestXP += milesRun * 5;
        }
    }

    experiencePoints += xp + sideQuestXP;

    let nextLevelXP = k * Math.floor(Math.pow(level, levelScale));

    while (experiencePoints >= nextLevelXP) {
        level++;
        experiencePoints -= nextLevelXP;  // Deduct the required XP for leveling up
        if (level <= 5) {
            levelScale = 1.06;
        } else if (level > 5 && level <= 10) {
            levelScale = 1.08;
        } else if (level > 10 && level <= 15) {
            levelScale = 1.1;
        } else if (level > 15 && level <= 20) {
            levelScale = 1.12;
        } else {
            levelScale = 1.15;
        }
        nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
    }

    // Save the updated experience points and level to localStorage
    localStorage.setItem('experiencePoints', experiencePoints);
    localStorage.setItem('level', level);

    // Update previous weight
    previousWeight = weight;
    localStorage.setItem('previousWeight', previousWeight);

    // Save the last submission day
    lastSubmissionDay = today;
    localStorage.setItem('lastSubmissionDay', lastSubmissionDay);

    updateLevelDisplay(nextLevelXP);

    let resultHTML = `<h2 style="margin-top: 15px">Earned Experience</h2>`;

    lastQuest.lastDay.forEach(item => {
        if (item === 'Cardio 2x') {
            resultHTML += `<p>${item} (Daily Quest): +10</p>`;
        } else if (item !== 'Calorie Count' && item !== 'Cardio') {
            resultHTML += `<p>${item} (Daily Quest): +5</p>`;
        }
    });

    resultHTML += `<p>Calorie Count: ${calorieCount ? "+5" : "+0"}</p>
                   <p>Weigh In: ${weight ? "+5" : "+0"}</p>
                   <p>Completed Workout Blocks: ${workoutBlocks ? "+" + (5 + (workoutBlocks - 1) * 5) : "+0"}</p>
                   <p>Miles Run (Side Quest): ${sideQuestXP > 0 ? "+" + sideQuestXP : "+0"}</p>
                   <h3>Experience Points Earned Today: ${xp + sideQuestXP}</h3>`;

    document.getElementById('results').innerHTML = resultHTML;
}

function updateQuestStatus() {
    const questItems = document.querySelectorAll('.quest-item');
    const dailyQuestItems = lastQuest.lastDay;

    questItems.forEach(item => {
        let questName = item.getAttribute('data-quest');
        if (questName !== 'Cardio' && questName !== 'Cardio 2x' && document.getElementById(`${questName.toLowerCase()}-completed`).checked) {
            item.innerHTML = `[ Completed ] ${questName}`;
        } else if (questName === 'Calorie Count' && document.getElementById('calories').value > 0) {
            item.innerHTML = `[ Completed ] ${questName}`;
        } else if (questName === 'Cardio' && document.getElementById('mile-count').value >= 1) {
            item.innerHTML = `[ Completed ] ${questName}`;
        } else if (questName === 'Cardio 2x' && document.getElementById('mile-count').value >= 2) {
            item.innerHTML = `[ Completed ] ${questName}`;
        } else {
            item.innerHTML = `[ Incomplete ] ${questName}`;
        }
    });
}

function updateLevelDisplay(nextLevelXP) {
    const progressPercent = (experiencePoints / nextLevelXP) * 100;

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

function dailyQuestGenerator(level, day) {
    const dailyQuestBeginner = ["Abs", "Weight Lifting", "Cardio"];
    const dailyQuestIntermediate = ["Abs", "Weight Lifting", "Cardio", "Boxing"];
    const dailyQuestRest = ["Rest Day", "Cheat/Rest Day"];
    let daily = [];

    // Handle rest days every 7th day
    if (day % 7 === 0) {
        daily = [dailyQuestRest[Math.floor(day / 7) % 2]];
    } else {
        daily.push("Calorie Count");  // Ensure "Calorie Count" is always included

        let availableQuests = level < 10 ? dailyQuestBeginner.slice() : dailyQuestIntermediate.slice();

        // Filter out "Cardio 2x" based on previous day selection
        if (lastQuest.lastDay.includes("Cardio")) {
            availableQuests = availableQuests.filter(q => q !== "Cardio 2x");
        } else if (lastQuest.lastDay.includes("Cardio 2x")) {
            availableQuests = availableQuests.filter(q => q !== "Cardio");
        }

        // Add quests based on level
        let numberOfQuests = level < 5 ? (Math.random() > 0.5 ? 1 : 0) : level <= 10 ? Math.floor(Math.random() * 2) + 1 : 2;

        for (let i = 0; i < numberOfQuests && availableQuests.length > 0; i++) {
            let quest = availableQuests.splice(Math.floor(Math.random() * availableQuests.length), 1)[0];
            daily.push(quest);
            if (quest === "Abs") lastQuest.abs = quest;
        }

        // Add "Weigh In" every 10th workout day
        if ((day % 10) === 0) {
            daily.push("Weigh In");
        }

        // Add "Cardio 2x" based on chance
        if (level > 20 && daily.includes("Cardio") && Math.random() < 0.15) {
            daily[daily.indexOf("Cardio")] = "Cardio 2x";
        }
    }

    // Update lastQuest to prevent duplicates
    lastQuest.lastDay = daily.slice(); // Include "Calorie Count"

    localStorage.setItem('lastQuest', JSON.stringify(lastQuest));

    const dailyQuestHTML = daily.map(item => `<div class="quest-item" data-quest="${item}">[ Incomplete ] ${item}</div>`).join("");
    const dailyQuestFormHTML = daily.filter(item => item !== 'Cardio' && item !== 'Cardio 2x' && item !== 'Calorie Count' && !item.includes('Day')).map(item => `
        <div class="input-group" id="${item.toLowerCase()}">
            <label>${item} Completed: <input type="checkbox" id="${item.toLowerCase()}-completed" onchange="updateQuestStatus()"></label>
        </div>`).join("");

    document.getElementById('daily').innerHTML = dailyQuestHTML;
    document.getElementById('daily-quest-items').innerHTML = dailyQuestFormHTML;

    // Update form visibility based on daily quest
    document.getElementById('calorie-count-group').style.display = daily.includes("Calorie Count") ? 'block' : 'none';
    document.getElementById('weigh-in-group').style.display = daily.includes("Weigh In") ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
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
        const savedQuest = JSON.parse(localStorage.getItem('lastQuest')) || {lastDay: []};
        const dailyQuestHTML = savedQuest.lastDay.map(item => `<div class="quest-item" data-quest="${item}">[ Incomplete ] ${item}</div>`).join("");
        const dailyQuestFormHTML = savedQuest.lastDay.filter(item => item !== 'Cardio' && item !== 'Cardio 2x' && item !== 'Calorie Count' && !item.includes('Day')).map(item => `
            <div class="input-group">
                <label>${item} Completed: <input type="checkbox" id="${item.toLowerCase()}-completed" onchange="updateQuestStatus()"></label>
            </div>`).join("");

        document.getElementById('daily').innerHTML = dailyQuestHTML;
        document.getElementById('daily-quest-items').innerHTML = dailyQuestFormHTML;

        // Update form visibility based on daily quest
        document.getElementById('calorie-count-group').style.display = savedQuest.lastDay.includes("Calorie Count") ? 'block' : 'none';
        document.getElementById('weigh-in-group').style.display = savedQuest.lastDay.includes("Weigh In") ? 'block' : 'none';
    }

    multipleSubmissionsAllowed = document.getElementById('allow-multiple-submissions').checked;
    document.getElementById('allow-multiple-submissions').addEventListener('change', (e) => {
        multipleSubmissionsAllowed = e.target.checked;
    });
});

function showForm() {
    document.getElementById('fitness-form').style.display = 'block';
    document.getElementById('profile-section').style.display = 'none';
    document.querySelector('.nav-buttons .left').classList.add('highlight');
    document.querySelector('.nav-buttons .right').classList.remove('highlight');
}

function showProfile() {
    document.getElementById('fitness-form').style.display = 'none';
    document.getElementById('profile-section').style.display = 'block';
    document.querySelector('.nav-buttons .left').classList.remove('highlight');
    document.querySelector('.nav-buttons .right').classList.add('highlight');

    document.getElementById('previous-weight').value = previousWeight;
    document.getElementById('goal-weight').value = goalWeight;
    document.getElementById('calorie-goal').value = calorieGoal;
    document.getElementById('is-min-calorie').checked = isMinCalorie;
    document.getElementById('step-goal').value = stepGoal;
}

function saveProfile() {
    previousWeight = document.getElementById('previous-weight').value;
    goalWeight = document.getElementById('goal-weight').value;
    calorieGoal = document.getElementById('calorie-goal').value;
    isMinCalorie = document.getElementById('is-min-calorie').checked;
    stepGoal = document.getElementById('step-goal').value;

    localStorage.setItem('previousWeight', previousWeight);
    localStorage.setItem('goalWeight', goalWeight);
    localStorage.setItem('calorieGoal', calorieGoal);
    localStorage.setItem('isMinCalorie', isMinCalorie);
    localStorage.setItem('stepGoal', stepGoal);

    alert('Profile saved!');
}

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
    if (isNaN(newExperience)) {
        alert('Please enter a valid number');
        return;
    }

    experiencePoints = newExperience;
    localStorage.setItem('experiencePoints', experiencePoints);

    // Update level based on new experience points
    level = 1;
    let nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
    while (experiencePoints >= nextLevelXP) {
        level++;
        experiencePoints -= nextLevelXP;
        nextLevelXP = k * Math.floor(Math.pow(level, levelScale));
    }
    localStorage.setItem('level', level);

    // Update the display
    updateLevelDisplay(nextLevelXP);
}

function generateNewDailyQuest() {
    dailyQuestGenerator(level, currentDay);
    localStorage.setItem('currentDay', currentDay); // Ensure the current day is saved
}

// Display current level and experience points on page load
document.addEventListener('DOMContentLoaded', () => {
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
        const savedQuest = JSON.parse(localStorage.getItem('lastQuest')) || {lastDay: []};
        const dailyQuestHTML = savedQuest.lastDay.map(item => `<div class="quest-item" data-quest="${item}">[ Incomplete ] ${item}</div>`).join("");
        const dailyQuestFormHTML = savedQuest.lastDay.filter(item => item !== 'Cardio' && item !== 'Cardio 2x' && !item.includes('Day')).map(item => `
            <div class="input-group">
                <label>${item} Completed: <input type="checkbox" id="${item.toLowerCase()}-completed" onchange="updateQuestStatus()"></label>
            </div>`).join("");

        document.getElementById('daily').innerHTML = dailyQuestHTML;
        document.getElementById('daily-quest-items').innerHTML = dailyQuestFormHTML;

        // Update form visibility based on daily quest
        document.getElementById('calorie-count-group').style.display = savedQuest.lastDay.includes("Calorie Count") ? 'block' : 'none';
        document.getElementById('weigh-in-group').style.display = savedQuest.lastDay.includes("Weigh In") ? 'block' : 'none';
    }

    multipleSubmissionsAllowed = document.getElementById('allow-multiple-submissions').checked;
    document.getElementById('allow-multiple-submissions').addEventListener('change', (e) => {
        multipleSubmissionsAllowed = e.target.checked;
    });
});
