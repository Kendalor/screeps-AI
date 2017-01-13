var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

module.exports = class{

        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                this.buildCreeps(id);
                if(!Memory.operations[id].toDefend){
                    if(Game.ticks % 50 == 0){
                        console.log('DEFEND OPERATION '+id+' HAS NOTHING TO DO');
                    }
                }else{
                    let defendId=Memory.operations[id].toDefend;
                }





            }
        }
        /*
        TODO: REASSIGN HEALERS HEADLESS HEALERS TO FALL BACK AND ASSIGN THEM A NEW SQUAD
        */
        static checkForCreeps(id){
            var creepName;
            for(var sLeader in Memory.operations[id].squads){
                creepName=sLeader;
                for(var cr in Memory.operations[id].squads[sLeader]){
                    creepName=Memory.operations[id].squads[sLeader][cr]
                    if(!Game.creeps[creepName]){
                        console.log('Deleted Healer '+creepName +'from memory')
                        delete Memory.creeps[creepName];
                        Memory.operations[id].squads[sLeader].pop(creepName);
                    }

                }
                if(!Game.creeps[sLeader]) {
                        console.log('Deleted '+ sLeader +' from memory')
                        delete Memory.creeps[sLeader];


                        for(var cr in Memory.operations[id].squads[sLeader]){
                                console.log('Deleted '+cr +'from memory')
                                Memory.operations[id].squads[sLeader].pop(cr);
                                Game.creeps[creepName].suicide();
                                delete Memory.creeps[creepName];
                        }
                        delete Memory.operations[id].squads[sLeader];
                }
            }
        }


        static buildCreeps(id){
            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size){
                var creep_body=Memory.operations[id].default_Abody;
                if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'MineDefender', operation: id, target: Memory.operations[id].flagName}) == OK){
                    var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{role: 'MineDefender', operation_id: id, target: Memory.operations[id].flagName});
                    Memory.operations[id].squads[name]= [];
                    console.log('Did spawn Op Defender'+name);
                }

            }else{
                for(var i in Memory.operations[id].members){
                    if(!Game.creeps[i]){
                        delete Memory.creeps[i];
                        delete Memory.operations[id].members[i];
                    }

                }
            }
            // CHECK IF REACHED OR FLAG POSITION CHANGED
        }

        static findClosestSpawn(flagName){
            var min_length;
            var best_spawn;
            var length;
            for(var i in Game.spawns){
                console.log('length from '+Game.spawns[i].pos.roomName+' to '+Game.flags[flagName].pos.roomName);
                console.log( Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length < min_length  || min_length == undefined);
                length= Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length;
                if(length < min_length  || min_length == undefined){
                    min_length=length;
                    best_spawn=Game.spawns[i].id;
                }
            }
            return best_spawn;
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
                Memory.operations[this.id].flagPos= Game.flags[flag].pos;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='defendKeeper';
                Memory.operations[this.id].size=1; // NUMBER OF SQUADS ATTACKER = SQUAD LEADER
                //COST 12xMOVE = 600 + 12 ATTACK = 960 =1560
                //Memory.operations[this.id].default_Abody=Array(50).fill(TOUGH,0,28).fill(MOVE,28,36).fill(ATTACK,36,50);// COST 2300
                Memory.operations[this.id].default_Abody=Array(50).fill(TOUGH,0,3).fill(MOVE,3,20).fill(ATTACK,20,45).fill(HEAL,45,50);// COST 2300
                Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                Memory.operations[this.id].members={};



                //console.log(JSON.stringify(Memory.operations[this.id]));
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
        // CHECK IF FLAG IS STILL EXISITING, IF NOT => DELETE OPERATION IF NOT PERMANENT
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
