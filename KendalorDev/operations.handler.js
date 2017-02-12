var attackOperation = require('class.operation.attack');
var colonizeOperation = require('class.operation.colonize');
var defendKeeperOperation = require('class.operation.defend_keeper');
//var demolishOperation = require('class.operation.demolish');
//var devAidOperation = require('class.operation.developmentAid');
var focusEnergyOperation = require('class.operation.focusEnergy');
var rangedAttackOperation = require('class.operation.ranged_attack');
var remoteBuildOperation = require('class.operation.remote_build');
var remoteMiningOperation = require('class.operation.remote_mining');
var remoteMiningKeeperOperation = require('class.operation.remote_mining_keeper');
var reserveOperation = require('class.operation.reserve');
var scoutingOperation = require('class.operation.scouting');
//var thiefOperation = require('class.operation.steal');
var thieveOperation = require('class.operation.thieve');
var tankOperation = require('class.operation.tank');


module.exports = {

    // HANDLE ALL OPERATIONS
    run: function() {
        //Travel to Location

        for(var id in Memory.operations){
            try {
                switch (Memory.operations[id].type) {
                    case 'scouting':
                        //console.log('Case: Scouting');
                        scoutingOperation.run(id);
                        break;
                    case 'attack':

                        attackOperation.run(id);
                        break;
                    case 'tank':
                        tankOperation.run(id);
                        break;
                    case 'thieve':
                        //console.log('Case: Steal');
                        //thiefOperation.run(id);
						thieveOperation.run(id);
                        break;
                    case 'reserve':
                        reserveOperation.run(id);
                        break;
                    case 'colonize':
                        colonizeOperation.run(id);
                        break;
                    case 'devAid':
                        //devAidOperation.run(id);
                        break;
                    case 'remote_mining':
                        remoteMiningOperation.run(id);
                        break;
                    case 'remote_build':
                        remoteBuildOperation.run(id);
                        break;
                    case 'defendKeeper':
                        defendKeeperOperation.run(id);
                        break;
                    case 'remote_mining_keeper':
                        remoteMiningKeeperOperation.run(id);
                        break;
                    case 'focusEnergy':
                        focusEnergyOperation.run(id);
                        break;
                    case 'ranged_attack':
                        rangedAttackOperation.run(id);
                        break;

					case 'demolish':
						//demolishOperation.run(id);
                        break;
                }
            }
            catch(err) {
				console.log(err.stack);
                console.log('In: '+Memory.operations[id].type+' ID: '+id);
            }
        }
    },
        init: function() {
        //Travel to Location
        for(var flag in Game.flags){

                if (this.colorMatch(flag,COLOR_RED,COLOR_RED)){ // RED/RED
                    attackOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_RED,COLOR_BLUE)){ //RED/BLUE
                    defendKeeperOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_WHITE)){ //WHITE/WHITE
                    scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_GREY)){ //WHITE/GREY
                    reserveOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_GREEN,COLOR_GREEN)){ //GREEN/GREEN
                    tankOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if(this.colorMatch(flag,COLOR_GREEN,COLOR_RED)){ //GREEN/RED
                    rangedAttackOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_GREEN)){ // WHITE/GREEN
                    colonizeOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_YELLOW)){ //WHITE/YELLOW
                    remoteBuildOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_WHITE,COLOR_BLUE)){ //WHITE/BLUE
                    //devAidOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if (this.colorMatch(flag,COLOR_BLUE,COLOR_BLUE)){ //BLUE/BLUE
                    remoteMiningOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

                }else if(this.colorMatch(flag,COLOR_BLUE,COLOR_RED)){ //BLUE/RED
                    remoteMiningKeeperOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
                }else if(this.colorMatch(flag,COLOR_BLUE,COLOR_WHITE)){ //BLUE/WHITE
                    focusEnergyOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
                }

                else if(this.colorMatch(flag,COLOR_GREY,COLOR_GREY)){ //GREY/GREY
                    //demolishOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
                }
				
				else if(this.colorMatch(flag,COLOR_ORANGE,COLOR_ORANGE)){ //ORANGE/ORANGE
                    thieveOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
                }

        }
    },

	colorMatch: function(flag,color1,color2) {
		return (Game.flags[flag].color == color1 && Game.flags[flag].secondaryColor == color2)
	}
};
