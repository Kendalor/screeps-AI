var scoutingOperation = require('class.operation.scouting');
var attackOperation = require('class.operation.attack');
var tankOperation = require('class.operation.tank');
var thiefOperation = require('class.operation.steal');
var reserveOperation = require('class.operation.reserve');
var colonizeOperation = require('class.operation.colonize');
var devAidOperation = require('class.operation.developmentAid');
var remoteMiningOperation = require('class.operation.remote_mining');
var remoteBuildOperation = require('class.operation.remote_build');
var penetrationOperation = require('class.operation.penetration');
var defendOperation = require('class.operation.defend');

module.exports = {

    /** @param {Flag_list} flag_list **/
    run: function() {
        //Travel to Location
        for(var flag in Game.flags){
            if(Game.flags[flag].color == COLOR_RED && Game.flags[flag].secondaryColor == COLOR_RED){

                attackOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }else if(Game.flags[flag].color == COLOR_RED && Game.flags[flag].secondaryColor == COLOR_BLUE){
                defendOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }else if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_WHITE){
                scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }else if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_GREY){
                reserveOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }else if(Game.flags[flag].color == COLOR_GREEN){
                tankOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }else if(Game.flags[flag].color == COLOR_BLUE && Game.flags[flag].secondaryColor == COLOR_RED){
                thiefOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
            
            else if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_GREEN){
                colonizeOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
			else if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_YELLOW){
                remoteBuildOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
            else if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_BLUE){
                devAidOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
            else if(Game.flags[flag].color == COLOR_BLUE && Game.flags[flag].secondaryColor == COLOR_BLUE){
                remoteMiningOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
			
			else if(Game.flags[flag].color == COLOR_RED && Game.flags[flag].secondaryColor == COLOR_BLUE){
                penetrationOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
        }
    }


};
