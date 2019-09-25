import { Build } from "./Build";

class BuildContainer extends Build {

    public static run(creep: Creep): void {
        super.run(creep);
    }

    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0 && this.getTargetId(creep) !== null;
    }

    public static getTargetId(creep: Creep): string | null {
        if ( creep.memory.conatinerId !== null) {
            return creep.memory.containerId;
        } else {
            const constructions: ConstructionSite[] = creep.room.constructionSitesByType(STRUCTURE_CONTAINER);
            if(constructions.length !== 0) {
                const site: ConstructionSite | null = creep.pos.findClosestByPath(constructions);
                if (site !== null) {
                    return site.id;
                }
            
            }
        return null;
        }
    }
}