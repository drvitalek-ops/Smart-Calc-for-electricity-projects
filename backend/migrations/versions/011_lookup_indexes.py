"""Index lookups used by large plans and catalogue reports; data stays unchanged."""
from alembic import op

revision='011'
down_revision='010'
branch_labels=None
depends_on=None

INDEXES={
    'pages':['project_id'],'rooms':['project_id','page_id'],'layers':['project_id'],
    'element_types':['seed_key'],
    'elements':['project_id','page_id','layer_id','type_id','product_id','room_id'],
    'products':['type_id','manufacturer_id','supplier_id'],
    'reports':['project_id'],
}

def upgrade():
    for table,columns in INDEXES.items():
        for column in columns:op.create_index(f'ix_{table}_{column}',table,[column])

def downgrade():
    for table,columns in reversed(list(INDEXES.items())):
        for column in reversed(columns):op.drop_index(f'ix_{table}_{column}',table_name=table)
