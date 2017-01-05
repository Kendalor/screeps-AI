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
var remoteMiningKeeperOperation = require('class.operation.remote_mining_keeper');


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
                case 'remote_mining_keeper':
                    remoteMiningKeeperOperation.run(id);
                    break;

            }
        }
    },
        init: function() {
        //Travel to Location
        for(var flag in Game.flags){
			if (this.colorMatch(flag,COLOR_RED,COLOR_RED)){ // RED/RED
                attackOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_RED,COLOR_BLUE)){ //RED/BLUE
                defendOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_WHITE)){ //WHITE/WHITE
                scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_GREY)){ //WHITE/GREY
                reserveOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_GREEN,COLOR_GREEN)){ //GREEN/GREEN
                tankOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_GREEN)){ // WHITE/GREEN
                colonizeOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

			}else if (this.colorMatch(flag,COLOR_WHITE,COLOR_YELLOW)){ //WHITE/YELLOW
                remoteBuildOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_BLUE)){ //WHITE/BLUE
                devAidOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if (this.colorMatch(flag,COLOR_BLUE,COLOR_BLUE)){ //BLUE/BLUE
                remoteMiningOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if(this.colorMatch(flag,COLOR_BLUE,COLOR_RED)){
                remoteMiningKeeperOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }
        }
    },

	colorMatch: function(flag,color1,color2) {
		return (Game.flags[flag].color == color1 && Game.flags[flag].secondaryColor == color2)
	}
};
