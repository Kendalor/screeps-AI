import { Job } from "./Job";

export class Repair extends Job{

    public static run(creep: Creep): void {
        super.run(creep);

        const target: Structure | null = <Structure> Game.getObjectById(creep.memory.targetId);
        // JOB CONDITION energy, target set, and needs repair.
        if(creep.carry.energy > 0 ){
            if(target != null){
                if(target.hits < target.hitsMax){
                        // JOB EXECUTION
                        if(creep.pos.inRangeTo(target,3)){
                            creep.repair(target);
                        }else{
                            creep.travelTo(target,{range:3 }); // ignoreRoads:true
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

        const repairTargets: Structure[] = creep.room.find(FIND_STRUCTURES).filter((structure) =>  structure.structureType !== STRUCTURE_WALL && structure.structureType !== STRUCTURE_RAMPART && structure.hits < structure.hitsMax*0.8);

        if(repairTargets.length > 0){
            const repairTarget = creep.pos.findClosestByPath(repairTargets);
            if(repairTarget != null){
                return repairTarget.id;
            }
        }
        return null;
    }




}