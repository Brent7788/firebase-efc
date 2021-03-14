import AbstractEntity from "../entities/AbstractEntity";
import onChange from "on-change";

export default class ObservableEntity<T extends AbstractEntity> {

    public entity: T;
    public haveEntityChanged = false;

    constructor(entity: T) {
        this.entity = entity;
    }

    public getObserveEntity() {
        return onChange(this, function (path, value, previousValue, name) {
            if (!this["haveEntityChanged"])
                this["haveEntityChanged"] = true;
        }).entity;
    }
}
