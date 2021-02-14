import firebase from "firebase/app";
import "firebase/firestore";
import type AbstractEntity from "../entities/AbstractEntity";
import DocumentData = firebase.firestore.DocumentData;
import CollectionReference = firebase.firestore.CollectionReference;
import WriteBatch = firebase.firestore.WriteBatch;

export default class FirebaseServiceEFC<T extends AbstractEntity> {

    private db = firebase.firestore();
    public entity: T;
    private readonly type: (new () => T);
    private readonly entityName;
    public providedEntity: boolean = false;
    public collectionRef: CollectionReference<DocumentData>;
    public batch: WriteBatch | undefined;

    constructor(type: (new () => T),
                entity: T | undefined = undefined,
                asBatch = false,
                batch: WriteBatch | undefined = undefined) {

        this.type = type;

        if (!entity) {
            this.entity = new type();
        } else {
            this.entity = entity;
            this.providedEntity = true;
        }
        if (asBatch && batch) {
            this.batch = batch;

        } else if (asBatch && !batch) {
            this.batch = this.db.batch()
        }

        this.entityName = this.entity.constructor.name;
        this.collectionRef = this.db.collection(this.entityName);
    }

    public async findAll(): Promise<T[]> {
        const snapshot = await this.collectionRef.get();

        let entities: Array<T> = [];

        snapshot.forEach((result) => {
            entities.push(Object.assign(new this.type(), result.data()))
        })

        return entities;
    }

    public async whereEquals(field: string, value: any, limit = 1) {
        try {
            const documentReference = this.collectionRef.where(field, "==", value).limit(limit);
            const querySnapshot = await documentReference.get();

            console.log('FFF', querySnapshot.size)
            if (querySnapshot.size > 0) {
                this.entity = Object.assign(new this.type(), querySnapshot.docs[0].data());
            } else {
                //TODO This should be more understandable
                this.providedEntity = false;
            }
        } catch (error) {
            console.log(`Unable to get document values by field(${field})`, error);
            //TODO This should be more understandable
            this.providedEntity = false;
        }
    }

    public async findById(id: string): Promise<T> {
        const documentReference = this.collectionRef.doc(id);
        const documentSnapshot = await documentReference.get();
        if (!documentSnapshot.exists) {
            throw Error(`${this.entityName} with this id: ${id} does not exist`);
        } else {
            return Object.assign(new this.type(), documentSnapshot.data());
        }
    }

    public commitBatch(): void {
        this.batch?.commit().then(value => {
            console.log('Successfully committed batch');
        }).catch(error => {
            console.error(`Error trying to commit`, error);
        });
    }

    public save(wait = false): void {
        console.log('Trying to save', this.providedEntity, this.entityName, this.entity.asObject(), this.collectionRef);
        if (this.providedEntity) {
            try {
                this.shouldWait(wait, () => {
                    try {
                        const ref = this.collectionRef
                            .doc(this.entity.id);

                        if (this.batch) {
                            this.batch.set(ref, this.entity.asObject());
                        } else {
                            ref.set(this.entity.asObject())
                                .then(value => {
                                    console.log('Successfully saved', this.entityName);
                                }).catch(error => {
                                    console.error(`Error trying to save entity(${this.entityName})`, error);
                                });
                        }
                    } catch (error) {
                    }
                });
            } catch (error) {
            }
        } else {
            console.warn(`Unable to save ${this.entityName}! No entity was provided.`)
        }
    }

    public saveAsync(wait = false): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            console.log('Trying to save', this.providedEntity, this.entityName, this.entity.asObject())
            if (this.providedEntity) {
                this.shouldWait(wait, () => {
                    try {
                        const ref = this.collectionRef
                            .doc(this.entity.id);

                        if (this.batch) {
                            this.batch.set(ref, this.entity.asObject());
                            resolve(true);
                        } else {
                            ref.set(this.entity.asObject())
                                .then(value => {
                                    console.log('Successfully saved', this.entityName);
                                    resolve(true);
                                }).catch(error => {
                                console.error(`Error trying to save entity(${this.entityName})`, error);
                                resolve(false);
                            });
                        }
                    } catch (error) {
                        resolve(false);
                    }
                });
            } else {
                console.warn(`Unable to save ${this.entityName}! No entity was provided.`);
                resolve(false);
            }
        });
    }

    public async delete(id: string | undefined = undefined) {
        return await this.collectionRef.doc((id) ? id : this.entity.id).delete();
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
}
