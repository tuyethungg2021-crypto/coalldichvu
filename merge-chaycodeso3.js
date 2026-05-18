const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const OLD_DB = 'coalldichvu';        // database cũ
const NEW_DB = 'co_all_dich_vu';     // database web hiện tại

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const oldColl = client.db(OLD_DB).collection('app_state');
  const newColl = client.db(NEW_DB).collection('app_state');

  const oldDoc = await oldColl.findOne({ _id: 'main' });
  const newDoc = await newColl.findOne({ _id: 'main' });

  if (!oldDoc || !newDoc) throw new Error("Không tìm thấy doc main");

  const oldRentals = (oldDoc.data?.rentals || []).filter(r =>
    (r.username || '').toLowerCase().includes('chaycodeso3')
  );

  const existingIds = new Set((newDoc.data?.rentals || []).map(r => r.id));
  const mergedRentals = [
    ...(newDoc.data.rentals || []),
    ...oldRentals.filter(r => !existingIds.has(r.id))
  ];

  await newColl.replaceOne(
    { _id: 'main' },
    { _id: 'main', data: { ...newDoc.data, rentals: mergedRentals }, updated_at: new Date().toISOString() }
  );

  console.log(`Merge xong! Tổng rentals: ${mergedRentals.length}`);
  await client.close();
}

main().catch(console.error);
