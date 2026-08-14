import { Build } from "./Build";

export class BuildPowerSpawn extends Build {
    public static run(creep: Creep): void {
        super.run(creep);
    }


    public static runCondition(creep: Creep): boolean {
        return super.runCondition(creep);
    }

    public static getTargetId(creep: Creep): string | null {
        let constructions: ConstructionSite[] = [];
        if( creep.room.controller!.level === 8) {
            constructions = creep.room.find(FIND_CONSTRUCTION_SITES).filter( site => site.structureType === STRUCTURE_POWER_SPAWN);
            if(constructions.length >0 ){
                const constructionsite = creep.pos.findClosestByPath(constructions);
                if(constructionsite != null ){
                    return constructionsite.id;
                }
            }
        }

        return null;
    }
}