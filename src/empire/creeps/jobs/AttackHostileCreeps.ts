import { Attack } from "./Attack";

export class AttackHostileCreeps extends Attack {

    public static run(creep: Creep): void {
        super.run(creep);
    }


    public static runCondition(creep: Creep): boolean {
        return super.runCondition(creep);
    }

    public static getTargetId(creep: Creep): string | null {
        const targets = creep.room.find(FIND_HOSTILE_CREEPS);
        if(targets.length > 0){
            const target = creep.pos.findClosestByPath(targets);
            if(target != null){
                return target.id;
            }
        }
        return null;
    }

}