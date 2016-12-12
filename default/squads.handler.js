module.exports = {

    /** @param {Flag_list} flag_list **/
    run: function() {
        //Travel to Location
        for(var squad in Memory.squads){
            if(!Game.flags[squad]){
                delete Memory.squads[squad];
                for(creep in Game.creeps){
                    var cr = Game.creeps[creep];
                    if(cr.memory.role == 'attacker' && cr.memory.squad == 'squad'){
                        cr.suicide();
                    }
                }

            }

            if(Object.keys(Memory.squads[squad].members).length < Memory.squads[squad].size && !Memory.squads[squad].assembled){
                //console.log('Spawning');
                console.log(Game.spawns['Spawn1'].createCreep(
                [TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,ATTACK,ATTACK,ATTACK,ATTACK,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE], undefined, {role: 'attacker', squad: squad, target: Memory.squads[squad].target}))
                /*if(Game.spawns['Spawn1'].createCreep([ATTACK,ATTACK,TOUGH,TOUGH,TOUGH], undefined, {role: 'attacker', squad: squad, target: Memory.squads[squad].target})){
                    Memory.squads[squad].count = Memory.squads[squad].count+1;
                }*/

            }else if(Object.keys(Memory.squads[squad].members).length == Memory.squads[squad].size && !Memory.squads[squad].assembled){
                Memory.squads[squad].assembled = true;
                console.log('Squad assembled');
            }

    
        }





    }





};
