import { Repair } from "./Repair";

export class RepairWall extends Repair {

    public static run(creep: Creep): void {
        super.run(creep);
    }

    public static getTargetId(creep: Creep): string | null {

        const repairTargets: Structure[] = creep.room.find(FIND_STRUCTURES)
        .filter((str => str.structureType === STRUCTURE_WALL))
        .filter((structure) => structure.hits < structure.hitsMax);
        if(repairTargets.length > 0){
            const target = creep.pos.findClosestByPath(repairTargets);
            if(target != null){
                return target.id;
            }
        }
        

        return null;
    }




}