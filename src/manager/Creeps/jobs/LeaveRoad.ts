import { Job } from "./Job";

export class LeaveRoad extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
    }

    public static runCondition(creep: Creep): boolean {
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        return null;
    }
}