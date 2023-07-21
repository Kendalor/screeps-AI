import { Job } from "./Job";

export class Upgrade extends Job{


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0  && creep.room.controller != null && creep.room.controller.my;
    }

    public static getTargetId(creep: Creep): string | null {
        return creep.room.controller!.id;
    }

    public static run(creep: Creep): void {
        super.run(creep);
        if(this.runCondition(creep)){
            const target: StructureController | null = <StructureController> Game.getObjectById(creep.memory.targetId);
            if(target !== null) {
                const rangeTo = creep.pos.getRangeTo(target);
                if(rangeTo <= 3){
                    creep.upgradeController(target);
                } else {
                    creep.travelTo(target);
                }
            } else {
                this.cancel(creep);
            } 
        } else {
            this.cancel(creep);
        }
    }

}