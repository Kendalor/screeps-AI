import { Job } from "./Job";

export class GoFlagRoom extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target = Game.flags[creep.memory.targetId];
        if(target != null){
            if(creep.pos.inRangeTo(target,10)){
                this.cancel(creep);

            } else {
                creep.moveTo(target);
            }
        } else {
            this.cancel(creep);
        }

    }


    public static runCondition(creep: Creep): boolean {
        if(creep.memory.flag != null){
            const flag = Game.flags[creep.memory.flag];
            if(flag.pos.roomName !== creep.pos.roomName){
                return true;
            }
        }
        return false;

    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.flag != null){
            const flag = Game.flags[creep.memory.flag];
            if(flag.pos.roomName !== creep.pos.roomName){
                return creep.memory.flag;
            }
        }
        return null;
    }
}