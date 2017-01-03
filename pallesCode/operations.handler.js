var scoutingOperation = require('class.operation.scouting');
var attackOperation = require('class.operation.attack');
var tankOperation = require('class.operation.tank');
var thiefOperation = require('class.operation.steal');
var reserveOperation = require('class.operation.reserve');
var colonizeOperation = require('class.operation.colonize');
var devAidOperation = require('class.operation.developmentAid');
var remoteMiningOperation = require('class.operation.remote_mining');
var remoteBuildOperation = require('class.operation.remote_build');
var defendOperation = require('class.operation.defend');

module.exports = {

    // HANDLE ALL OPERATIONS
    run: function() {
        //Travel to Location

        for(var id in Memory.operations){
            switch (Memory.operations[id].type) {
                case 'scouting':
                    //console.log('Case: Scouting');
                    scoutingOperation.run(id);
                    break;
                case 'attack':

                    attackOperation.run(id);
                    break;
                case 'tank':
                    console.log('Case: Tanking');
                    tankOperation.run(id);
                    break;
                case 'steal':
                    //console.log('Case: Steal');
                    thiefOperation.run(id);
                    break;
                case 'reserve':
                    reserveOperation.run(id);
                    break;
                case 'colonize':
                    colonizeOperation.run(id);
                    break;
                case 'devAid':
                    devAidOperation.run(id);
                    break;
                case 'remote_mining':
                    remoteMiningOperation.run(id);
                    break;
				case 'remote_build':
					remoteBuildOperation.run(id);
					break;
                case 'defend':
                    defendOperation.run(id);
                    break;

            }
        }
    }
};
