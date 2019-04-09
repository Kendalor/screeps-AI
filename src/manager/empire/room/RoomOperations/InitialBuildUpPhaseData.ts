export interface InitialBuildUpPhaseDataMemory {
    firstRun: boolean;
}

export class InitialBuildUpPhaseData implements InitialBuildUpPhaseDataMemory {
    public firstRun: boolean;

    constructor(roomName: string){
        this.firstRun = true;
    }
}