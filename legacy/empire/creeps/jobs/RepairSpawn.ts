import { Repair } from "./Repair";

export class RepairSpawn extends Repair {

    public static run(creep: Creep): void {
        super.run(creep);
    }

    public static getTargetId(creep: Creep): string | null {

        const repairTargets: Structure[] = creep.room.find(FIND_MY_SPAWNS)
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