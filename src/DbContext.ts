import firebase from "firebase/app";
import "firebase/firestore";
import DbFirestore from "./DbFirestore";
import DecoratorTool from "./tools/DecoratorTool";
import AbstractEntity from "./entities/AbstractEntity";

export default class DbContext {

    private db = firebase.firestore();
    private batch = this.db.batch();
    private dbSetFieldNames = DecoratorTool.getMyPropertyDecoratorValues(this.constructor, "DbSet");
    private fetchTimeOut = 3000;
    private check: any;
    private longRunningThread = false;

    public writeError = false;

    constructor() {
    }

    protected initializeDbFireStore(types: (new () => any)[]): void {
        if (types) {
            for (const type of types) {
                let entity = new type();
                for (let dbSetName of this.dbSetFieldNames) {
                    if (entity.constructor.name === this.capitalizeFirstLetter(dbSetName)) {
                        (<any>this)[dbSetName] = new DbFirestore(type, entity, this.db, this.batch);
                    }
                    console.log(this.capitalizeFirstLetter(dbSetName));
                }
            }
        }
    }

    public set<T extends AbstractEntity>(entity: T | undefined, wait = false): void {

        this.validateEntityBeforeWrite(entity);

        this.shouldWait(wait, () => {
            const ref = this.db.collection((<T>entity).constructor.name)
                .doc((<T>entity).id);

            this.batch.set(ref, (<T>entity).asObject());
        });
    }

    private update<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.update(ref, (<T>entity).asObject());
    }

    public delete<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.delete(ref);
    }

    //TODO There is a problem with long running code that is going to be updated
    //     It does not update
    public handleLongRunningCode(running: () => Promise<void>): void {
        this.longRunningThread = true;

        running().then(value => {
            console.log('AM I DONE', value);
            this.longRunningThread = false;
        }).catch(error => {
            this.writeError = true;
            this.longRunningThread = false;
            console.error(error);
        })
    }

    public async saveChangesAsync() {
        let test = 0;
        return new Promise<void>((resolve, reject) => {
            try {
                const dbSets = this.getDbSets().filter(dbSet => dbSet);

                if (dbSets.length === 0)
                    reject("There is no entities to save");

                setTimeout(() => {
                    clearInterval(this.check);
                }, this.fetchTimeOut);

                let alreadyCommitted = false;
                //TODO This mite not be a good idea
                this.check = setInterval(async () =>  {
                    try {
                        test++;
                        console.log("hello" , test, this.writeError, alreadyCommitted, this.longRunningThread);
                        if (!this.longRunningThread && !alreadyCommitted) {
                            const stillRun = dbSets.filter(dbSet => dbSet.isRunConcurrently);

                            if (stillRun.length === 0 && !alreadyCommitted) {

                                this.updateObservableEntities(dbSets);

                                if (!this.writeError && !alreadyCommitted) {
                                    alreadyCommitted = true;
                                    await this.batch.commit()
                                }
                                clearInterval(this.check);
                            }
                        }
                    } catch (error) {
                        clearInterval(this.check);
                        reject(`Unable to save changes, ${error}`);
                    }
                }, 50);
            } catch (error) {
                reject(`Unable to save changes, ${error}`)
            }
        });
    }

    private getDbSets(): DbFirestore<any>[] {
        return this.dbSetFieldNames.map(dbSetFieldName => <DbFirestore<any>>(<any>this)[dbSetFieldName]);
    }

    private updateObservableEntities(dbSets: DbFirestore<any>[]): void {
        const entitiesToUpdate = dbSets
            .map(dbSet => dbSet.observableEntities.filter(o => o.haveEntityChanged))
            .flat();

        for (const entitiesToUpdateElement of entitiesToUpdate) {
            this.update(entitiesToUpdateElement.entity);
        }
    }

    private validateEntityBeforeWrite<T extends AbstractEntity>(entity: T | undefined) {
        if (!entity) {
            this.writeError = true;
            //TODO Improve error message
            throw new Error(`Please provide entity to write`);
        }

        if (!entity.id) {
            this.writeError = true;
            throw new Error(`Entity(${(<T>entity).constructor.name}) doesn't have unique identifier(id)`);
        }
    }

    //TODO This is workaround for firebase bug. Data wound save in async function or call back function.
    //     after waiting for one second, then data save.
    private shouldWait(wait: boolean, func: () => void): void {
        if (wait) {
            setTimeout(func, 1000);
        } else {
            func();
        }
    }

    private capitalizeFirstLetter(str: any): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}