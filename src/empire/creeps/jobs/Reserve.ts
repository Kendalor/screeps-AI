import { Job } from "./Job";

export class Reserve extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureController | null = Game.getObjectById(creep.memory.targetId) as StructureController;
        if(target != null){
            if(creep.pos.inRangeTo(target,1)){
                creep.reserveController(target);
            } else {
                creep.travelTo(target);
            }
        } else {
            this.cancel(creep);
        }
    }

}