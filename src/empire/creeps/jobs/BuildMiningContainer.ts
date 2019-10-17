import { BuildContainer } from "./BuildContainer";

export class BuildMiningContainer extends BuildContainer {
    public static run(creep: Creep): void {
        super.run(creep);
    }



    public static runCondition(creep: Creep): boolean {
        return super.runCondition(creep);
    }

    public static getTargetId(creep: Creep): string | null {
        creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
        return super.getTargetId(creep);
    }
}