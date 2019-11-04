import { Job } from "./Job";

export class Build extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        
        // RUN LOGIC 
        const target: ConstructionSite | null = Game.getObjectById(creep.memory.targetId);
        // RUN CONDITIONS + HAS TARGET
        // JOB CANCEL CONDITIONS
		if((target == null || creep.carry.energy === 0)){
			this.cancel(creep);
        } else {
            if(creep.carry.energy > 0 ){
                if(creep.pos.inRangeTo(target,3)){
                    const err = creep.build(target);
                    console.log("Creep: " + creep.name + " err: " + err);
                    if(err === ERR_INVALID_TARGET){
                        // TARGET INVALID => Target is Already Built or Destroyed
                        this.cancel(creep);
                    } else if (err !== OK){
                        console.log(err);
                    }
                }else{
                    const err = creep.moveTo(target, {range: 3});
                }
            } else {
                this.cancel(creep);
            }
        }

        // JOB CANCEL CONDITIONS
		if((target == null || creep.carry.energy === 0)){
			this.cancel(creep);
		}
    }


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0 ;
    }

    public static getTargetId(creep: Creep): string | null {
        let constructions: ConstructionSite[] = [];
        if(constructions.length === 0 && creep.room.controller!.level > 1) {
            constructions = creep.room.find(FIND_CONSTRUCTION_SITES);
        }
        // TAREGTS FOUND ?
        if(constructions.length > 0){
            // START JOB: SET MEMORY
            const targetSite = creep.pos.findClosestByPath(constructions);
            if (!(targetSite === null || targetSite === undefined)) {
                return targetSite.id;
            }
        }
        return null;
    }
}