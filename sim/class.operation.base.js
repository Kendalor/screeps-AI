

module.exports = class{
        constructor(){
        }

        static run(id){
            /*
            SWITCH CASE OVER CURRENT STATUS AND CONTROLLER LEVEL
            */
            if(!this.checkForDelete(id)){
                switch(Game.rooms[Memory.operations[id].roomName].controller.level){
                    //                              EVERYTHING SUBEJCT TO CHANGE
                    //CONTROLLER LEVEL 1
                    //IN: AT START OF ROOM
                    //OUT: IF CONTROLLER REACHES LEVEL 2
                    //GOAL: (IN ORDER)
                    //       1) INITIALIZE MEMORY
                    //       2) BUILD APPROPRIATE NUMBER OF CREEPS
                    //       3) UPGRADE CONTROLLER LEVEL
                    case 1:
                        break;
                    //CONTROLLER LEVEL 2
                    //IN: AFTER REACHING CONTROLLER LEVEL 2, NOT @ MAX EXTENSIONS
                    //OUT: IF CONTROLLER REACHES LEVEL 3
                    //GOAL: (IN ORDER)
                    //      BUILD EXTENSIONS
                    //      RUSH TO CONTROLLER LEVEL 3
                    case 2:
                        break;
                    //CONTROLLER LEVEL 3
                    //IN: AFTER REACHING CONTROLLER LEVEL 3, NOT @ MAX EXTENSIONS
                    //OUT: IF CONTROLLER REACHES LEVEL 4
                    //GOAL: (IN ORDER)
                    //      BUILD EXTENSIONS
                    //      BUILD TOWER
                    //      BUILD CONTAINER
                    //      BUILD ROADS
                    //      CONVERT TO MINER/HAULER SETUP
                    //      RUSH TO CONTROLLER LEVEL 4
                    case 3:
                        break;

                }
            }
        }

        static init(roomName,flag){
            if(!Game.flags[flag].memory.operation_id){
                if(!Memory.operations){
                        Memory.operations={};
                }
                this.id=parseInt(Math.random()*10000000);
                console.log(this.isIdFree(this.id));
                while(!this.isIdFree(this.id)){
                    this.id=parseInt(Math.random()*10000000);
                }

                this.roomName=roomName;
                console.log(flag);
                console.log(this.id);
                console.log(this.roomName);
                this.flagName=flag;

                Game.flags[flag].memory.operation_id=this.id;

                if(!Memory.operations[this.id]){
                    Memory.operations[this.id]={}
                }
                //DEFINE ALL OP VARIABLES HERE
                Memory.operations[this.id].roomName=roomName;
                Memory.operations[this.id].flagName=flag;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='base';

                console.log(JSON.stringify(Memory.operations[this.id]));
            }
        }
        // CHECK IF ID IS AVAILABLE
        static isIdFree(id){
            var out=true;
            for(var i in Memory.operations){
                if(Memory.operations[id]){
                    out= false;
                }
            }
            return out;
        }
        // INIT ROOM MEMORY FOR EVERYTHING HERE
        static initMemory(id){
        // SOURCES ( OLD CODE)
            if(!Game.rooms[Memory.operations[id].roomName].sources){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].sources = {}; //Add it
                var room= Game.rooms[Memory.operations[id].roomName];
                var sources = room.find(FIND_SOURCES);//Find all sources in the current room
                for(var i in sources){
                    var source = sources[i];
                    source.memory = Game.rooms[Memory.operations[id].roomName].sources[source.id] = {}; //Create a new empty memory object for this source
                    // GET ACCESSIBLE POSITIONS FOR EACH SOURCE
                    var positions=Game.rooms[Memory.operations[id].roomName].lookAtArea(25-1,36-1,25+1,36+1,{asArry: true}), (temp) => temp.type == 'terrain' && temp.terrain != 'wall').length
                    Game.rooms[Memory.operations[id].roomName].sources[source.id].slots=positions;
                    Game.rooms[Memory.operations[id].roomName].sources[source.id].harvesters=[];
                }
            }
        // SPAWNS
            if(!Game.rooms[Memory.operations[id].roomName].spawns){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].spawns = {}; //Add it
                var room= Game.rooms[Memory.operations[id].roomName];
                var spawns = room.find(FIND_MY_SPAWNS);//Find all sources in the current room
                for(var i in spawns){
                    var spawn = spawns[i];
                    Game.rooms[Memory.operations[id].roomName].spawns[spawn.id] = spawn.memory = {} //Create a new empty memory object for this source
                }
            }
        // CONSTRUCTION SITES AS ID HASH LIST
            if(!Game.rooms[Memory.operations[id].roomName].constructionSites){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].constructionSites = {}
            }
        // CREEPS AS LIST WITH NAMES(HASK KEYS)
            if(!Game.rooms[Memory.operations[id].roomName].creeps){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].creeps = {}
            }
        // BUILDINGS AS ID LIST
            if(!Game.rooms[Memory.operations[id].roomName].structures){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].structures = {}
            }

        // PARAMETERS
            if(!Game.rooms[Memory.operations[id].roomName].baseSpecs){
                Game.rooms[Memory.operations[id].roomName].specs = {}
                Game.rooms[Memory.operations[id].roomName].specs.mode='default';
                Game.rooms[Memory.operations[id].roomName].specs.security='safe';
            }
        }

        // RUN EVERYTICK
        //TO READ EVERYTHING FROM ROOM INTO MEMORY
        static refreshMemory(id){
            var creeps=Game.rooms[Memory.operations[id].roomName].find(FIND_MY_CREEPS);
            var structures=Game.rooms[Memory.operations[id].roomName].find(FIND_STRUCTURES);
            for(var i in creeps){
                Game.rooms[Memory.operations[id].roomName].creeps[creeps[i].name]=creeps[i];


            }
        }


        static checkForDelete(id){
            var flagname =  Memory.operations[id].flagName;
            if(!Game.flags[flagname] && !Memory.operations[id].permanent){
                delete Memory.flags[flagname];
                delete Memory.operations[id];
                return true;
            }else {
                return false;
            }
        }
};
