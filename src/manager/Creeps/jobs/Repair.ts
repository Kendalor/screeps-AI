import { Job } from "./Job";

export class Repair extends Job{


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0 && this.getTargetId(creep) !== null;
    }

    public static getTargetId(creep: Creep): string | null {

        let repairTargets: Structure[] = creep.room.roads.filter((structure) => structure.hits < structure.hitsMax-1500);

        if(repairTargets.length  > 0 && creep.room.energyCapacityAvailable>=1300){

            if(!creep.room.memory.structureHitsMin){
                creep.room.memory.structureHitsMin = 5000; 
            }

            const minHits = creep.room.memory.structureHitsMin;
            if(repairTargets.length === 0){
                repairTargets = creep.room.ramparts.filter((structure) => structure.hits < minHits);
            }

            if(repairTargets.length === 0){
                repairTargets = creep.room.constructedWalls.filter((structure) => structure.hits < minHits);
            }

            if(repairTargets.length === 0 && minHits < 15000000){
                creep.room.memory.structureHitsMin += 1000; 
            }
        }

        // END REPAIR TARGET LOGIC

        // FOUND REPAIR TARGETS ?
        if(repairTargets.length > 0){
            const repairTarget = creep.pos.findClosestByPath(repairTargets);
            if(repairTarget){
                const type = repairTarget.structureType;
                if(type === STRUCTURE_RAMPART || type === STRUCTURE_WALL){
                    creep.room.memory.structureHitsMin = repairTarget.hits;
                }
                return repairTarget.id;
            }
        }
        return null;
    }

    public static cancel(creep: Creep): void {
        if(creep.memory.job === 'Repair'){
            creep.memory.targetId = undefined;
            creep.memory.job = undefined;
        }
    }

    public static run(creep: Creep): void {

        const target: Structure | null = Game.getObjectById(creep.memory.targetId);
        // JOB CONDITION energy, target set, and needs repair.
        if(creep.carry.energy > 0 && creep.memory.job ==='Repair' && target != null && target.hits < target.hitsMax){
            // JOB EXECUTION
            if(creep.inRangeTo(target,3)){
                creep.repair(target);
            }else{
                creep.moveTo(target,{range:3,ignoreCreeps:true,reusePath:50}); // ignoreRoads:true
            }
        }
        // JOB CANCEL CONDITION(S)
        if((target === null || creep.carry.energy === 0 || target.hits === target.hitsMax) && creep.memory.job === 'Repair'){
            this.cancel(creep);
        }
    }

}