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

    /** @param {Flag_list} flag_list **/
    run: function() {
        //Travel to Location
        for(var flag in Game.flags){
            }if (this.colorMatch(flag,COLOR_WHITE,COLOR_WHITE)){ //WHITE/WHITE
                scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }
        }
    },
	
	colorMatch: function(flag,color1,color2) {
		return (Game.flags[flag].color == color1 && Game.flags[flag].secondaryColor == color2)
	}


};
