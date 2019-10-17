import { Job } from "./Job";

export class ConstructContainer extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
    }

    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0 ;
    }

    public static getTargetId(creep: Creep): string | null {
        if ( creep.memory.conatinerId === null || creep.memory.containerId === undefined) {
            const constructions: ConstructionSite[] = creep.room.constructionSitesByType(STRUCTURE_CONTAINER);
            if(constructions.length !== 0) {
                const site: ConstructionSite | null = creep.pos.findClosestByPath(constructions);
                if (site !== null) {
                    return site.id;
                }
            
            }
        
        }
        return null;
    }
}