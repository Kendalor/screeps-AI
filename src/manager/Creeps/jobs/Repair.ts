import { Job } from "./Job";

export class Repair extends Job{

    public static run(creep: Creep): void {
        super.run(creep);

        const target: Structure | null = Game.getObjectById(creep.memory.targetId);
        // JOB CONDITION energy, target set, and needs repair.
        if(creep.carry.energy > 0 ){
            if(target != null){
                if(target.hits < target.hitsMax){
                        // JOB EXECUTION
                        if(creep.inRangeTo(target,3)){
                            creep.repair(target);
                        }else{
                            creep.moveTo(target,{range:3, ignoreCreeps:false }); // ignoreRoads:true
                        }
                } else {
                    this.cancel(creep);
                }
            } else {
                this.cancel(creep);
            }
        } else {
            this.cancel(creep);
        }
    }


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0 ;
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




}