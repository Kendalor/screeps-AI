# Kendalor Screeps AI

## Basic Usage

You will need:

 - [Node.JS](https://nodejs.org/en/download) (>= 8.0.0)
 - A Package Manager ([Yarn](https://yarnpkg.com/en/docs/getting-started) or [npm](https://docs.npmjs.com/getting-started/installing-node))
 - Rollup CLI (Optional, install via `npm install -g rollup`)

Download the latest source [here](https://github.com/screepers/screeps-typescript-starter/archive/master.zip) and extract it to a folder.

Open the folder in your terminal and run your package manager to install install the required packages and TypeScript declaration files:

```bash
# npm
npm install

Fire up your preferred editor with typescript installed and you are good to go!

### Rollup and code upload

Kendalor Screeps AI uses rollup to compile the Typescript and push it to the screeps Server. Therefore rename the `screeps.sample.json` to `screeps.json` and edit it, changing the credentials and optionally adding or removing some of the destinations. Default destinations are 'dev', 'main', 'sim'.

Running `rollup -c` will compile your code and do a "dry run", preparing the code for upload but not actually pushing it. Running `rollup -c --environment DEST:main` will compile your code, and then upload it to a screeps server using the `main` config from `screeps.json`.

Further NPM Scripts are implemented in the `package.json` for IDE integration. Running `npm run push-main` is equivalent to `rollup -c --environment DEST:main`, and `npm run watch-sim` is equivalent to `rollup -cw --dest sim`.

#### Important! To upload code to a private server, you must have [screepsmod-auth](https://github.com/ScreepsMods/screepsmod-auth) installed and configured!

## Typings

The type definitions for Screeps come from [typed-screeps](https://github.com/screepers/typed-screeps). If you find a problem or have a suggestion, please open an issue there.

## Structure

### Managers

All Logic is structured in levels  at coressponding 'Manager' classes. At the head is the Empire Manager, invoking Empire wide logic (trade, scouting, etc). For each Room exists a 'RoomManager' invoking the logic coressponding to each Room, which includes a 'SpawnManager'. 

### Operations

All Logic is bundled and executed in 'Operations'. This allows reusing code with different Parameters, for Defending a Room, Remote Mining, and other Tasks. 'Operations' can spawn other Operations and are structured in 3 Methods: 'onFirstRun()', 'run()' and 'onLastRun()'. Which executus Logic for the first Runs (e.g. enque needed Creeps in the SpawnManager), Logic executed every Tick (e.g. Check if 'onLastRun()' requirements are met). And lastly cleaning Up the operations (removing Creeps from the 'SpawnManager') or creating new Operations for this, or other Rooms. 

### Data 

Every read/write operation is located in corresponding 'Data'- Classes and nowhere else, to have only one place to look, if fields are missing, or have unpredicted values. 
