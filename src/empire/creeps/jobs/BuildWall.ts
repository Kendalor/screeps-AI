import { Build } from "./Build";

export class BuildWall extends Build {
    public static run(creep: Creep): void {
        super.run(creep);
    }


    public static runCondition(creep: Creep): boolean {
        return super.runCondition(creep);
    }

    public static getTargetId(creep: Creep): string | null {
        let constructions: ConstructionSite[] = [];
        if( creep.room.controller!.level >= 5) {
            constructions = creep.room.find(FIND_CONSTRUCTION_SITES).filter( site => site.structureType === STRUCTURE_WALL);
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