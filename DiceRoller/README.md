# DiceRoller
Modified Bee's Dice Roller (https://andylawton.com/home/bee-dice-roller)

Uses standard dice notation: 1d4, 2d6, etc.


Integrated URL customization

--  dicehex - hexcode - sets the dice’s body colour. 

--  labelhex - hexcode - sets the number’s colour. 

--  transparency - number 0-1 - set’s an opacity on the dice.

--  chromahex - hexcode - sets background colour

--  shadows - 0 or 1 - turns off dice shadows. 

--  noresult - no input- turns off the results text

--  roll- no input- immediately rolls on page load.

--  d - dice notation (see below) - set’s the starting dice

-- dicevalue - forces dice roll to be this value (There were no safe guards put in place against unexpected values. This was a quick and dirty addition to be able to make specific rolls. Only tested with d20 notation on values between 1-20)
  
 Added URL customization:
 
--  scale - number (including decimals) - scales the size of the dice

--- in use: scale=2 doubles the size of the dice, scale=0.5 halves the size of the dice, scale=0.05 makes the dice super tiny
  
 example link: http://URL/?dicehex=4E1E78&labelchex=CC9EEC&chromahex=FBFF00&d=2d20&roll
 
  
  Running the dice roller:
  copy index.html, dice.css, dice.js, main.css, main.js, teal.js and /libs to your web server
  -- NOTE: /libs contains two files: cannon.min.js and three.min.js
  
  Baked-in parameter setting can be done by editing main.js, starting at line 31.  
  In this adaptation, I have set the background, dice/label colors and turned off shadows because I
  didn't want to have to keep passing the same URL parameters over and over.
