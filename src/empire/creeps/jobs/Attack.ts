import { Job } from "./Job";

export class Attack extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: Structure | null = Game.getObjectById(creep.memory.targetId) as Structure;
        if(target != null){
            if(creep.pos.inRangeTo(target,1)){
                creep.attack(target);
            } else {
                creep.moveTo(target);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }
}