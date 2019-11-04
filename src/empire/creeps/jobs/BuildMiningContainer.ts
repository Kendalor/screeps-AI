import { BuildContainer } from "./BuildContainer";

export class BuildMiningContainer extends BuildContainer {
    public static run(creep: Creep): void {
        super.run(creep);
    }



    public static runCondition(creep: Creep): boolean {
        if(creep.memory.sourceId != null){
            const source = Game.getObjectById(creep.memory.sourceId);
            if(source != null) {
                return super.runCondition(creep);
            }
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.sourceId != null){
            const source: Source | null = Game.getObjectById(creep.memory.sourceId);
            if(source != null) {
                const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES,1).filter( c => c.structureType === STRUCTURE_CONTAINER);
                if(sites.length > 0){
                    const site = sites.pop();
                    if (site != null){
                        return site.id;
                    }
                }
            }
        }
        return null;
    }
}