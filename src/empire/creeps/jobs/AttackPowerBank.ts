import { Attack } from "./Attack";

export class AttackHostileStructures extends Attack {

    public static run(creep: Creep): void {
        super.run(creep);
    }


    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        const targets = creep.room.find(FIND_STRUCTURES).filter( str => str.structureType === STRUCTURE_POWER_BANK);
        if(targets.length > 0){
            const target = creep.pos.findClosestByPath(targets);
            if(target != null){
                return target.id;
            }
        }
        return null;
    }

}