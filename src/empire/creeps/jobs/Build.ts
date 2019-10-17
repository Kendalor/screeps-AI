import { Job } from "./Job";

export class Build extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        
        // RUN LOGIC 
        const target: ConstructionSite | null = Game.getObjectById(creep.memory.targetId);
        // RUN CONDITIONS + HAS TARGET
        if(target === null) {
            const id = this.getTargetId(creep);
            if(id !== null) {
                creep.memory.targetId = id;
                this.run(creep);
            }
        } else {
            if(creep.carry.energy > 0 && target !== null){
                if(creep.pos.inRangeTo(target,1)){
                    if(creep.build(target) === ERR_INVALID_TARGET){
                        // TARGET INVALID => Target is Already Built or Destroyed
                        this.cancel(creep);
                    }
                }else{
                    creep.moveTo(target);
                }
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
            constructions = creep.room.constructionSitesByType(STRUCTURE_EXTENSION);
        }
        if(constructions.length === 0) {
            constructions = creep.room.constructionSitesByType(STRUCTURE_CONTAINER);
        }
        if(constructions.length === 0) {
            constructions = creep.room.constructionSitesByType(STRUCTURE_STORAGE);
        }
        if(constructions.length === 0 && creep.room.controller!.level > 2) {
            constructions = creep.room.constructionSitesByType(STRUCTURE_TOWER);
        }
        if(constructions.length === 0) {
            constructions = creep.room.constructionSitesByType(STRUCTURE_ROAD);
        }
        if(constructions.length === 0) {
            constructions = creep.room.constructionSitesByType(STRUCTURE_WALL);
        }
        if(constructions.length === 0) {
            constructions = creep.room.constructionSites;
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